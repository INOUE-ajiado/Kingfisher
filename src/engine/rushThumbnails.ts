/**
 * ラッシュのタイムラインに並べるサムネイルを動画から切り出す。
 *
 * ⚠️ クラウド上の動画から切り出そうとしないこと。別オリジンの動画を canvas に描くと
 * CORS の設定が無い限り canvas が汚染されて toDataURL が例外になる。
 * アップロードする前の手元のファイル (blob: URL) から作って、ルームの文書に一緒に保存する。
 */

const THUMB_WIDTH = 120;
const THUMB_HEIGHT = 68;
/** 1 回のシークを待つ上限。デコードできない形式で止まらないように */
const SEEK_TIMEOUT_MS = 1500;

function waitForEvent(target: HTMLVideoElement, okEvent: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      target.removeEventListener(okEvent, onOk);
      target.removeEventListener('error', onError);
      clearTimeout(timer);
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    target.addEventListener(okEvent, onOk);
    target.addEventListener('error', onError);
  });
}

/** 動画の src から等間隔に count 枚のサムネイル (JPEG の data URL) を作る。作れなければ空配列 */
export async function generateVideoThumbnails(
  src: string,
  count = 14,
  isCancelled: () => boolean = () => false
): Promise<string[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;

  try {
    const loaded = await waitForEvent(video, 'loadedmetadata', 10000);
    if (!loaded || !Number.isFinite(video.duration) || video.duration <= 0 || isCancelled()) return [];

    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const interval = video.duration / count;
    const generated: string[] = [];
    for (let i = 0; i < count; i++) {
      if (isCancelled()) return [];
      video.currentTime = (i + 0.5) * interval;
      await waitForEvent(video, 'seeked', SEEK_TIMEOUT_MS);
      try {
        ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        generated.push(canvas.toDataURL('image/jpeg', 0.5));
      } catch {
        // canvas が汚染された (別オリジン) などで描けないときは、そこまでで打ち切る
        break;
      }
    }
    return generated;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** 手元のファイルからサムネイルを作る */
export async function generateThumbnailsFromFile(file: File, count = 14): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    return await generateVideoThumbnails(url, count);
  } catch (err) {
    console.warn('Failed to generate rush thumbnails:', err);
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * タイムラインのタイル用に、動画から指定のコマを 1 枚ずつ切り出す。
 *
 * 見えているタイルのコマを want() で渡すと、裏の <video> を順にシークして描き、
 * 切り出せるたびに onUpdate を呼ぶ。拡大・縮小やスクロールで want() が呼び直されたら、
 * 待ち行列を差し替える (見えなくなったコマは切り出さない)。
 *
 * クラウド上の動画は Storage の CORS 設定 (storage.cors.json) が前提。
 * CORS が無いと読み込みか描画で失敗し、isFailed が true になる (保存済みのサムネイルだけで表示する)。
 */
export class VideoFrameSampler {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  /** コマ → JPEG の data URL。Map の挿入順を古い順として使い、上限を超えたら古いものから捨てる */
  private readonly cache = new Map<number, string>();
  private readonly ready: Promise<boolean>;
  private wanted: number[] = [];
  private running = false;
  private disposed = false;
  private failed = false;
  private notifyScheduled = false;

  constructor(
    src: string,
    private readonly fps: number,
    private readonly onUpdate: () => void,
    private readonly options: { width: number; height: number; maxCache: number } = {
      width: 160,
      height: 90,
      maxCache: 800,
    }
  ) {
    this.video = document.createElement('video');
    this.video.crossOrigin = 'anonymous';
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.src = src;

    this.canvas = document.createElement('canvas');
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    this.ctx = this.canvas.getContext('2d');

    this.ready = waitForEvent(this.video, 'loadedmetadata', 15000).then((ok) => {
      if (!ok || !this.ctx) this.markFailed();
      return ok && !!this.ctx;
    });
  }

  get isFailed(): boolean {
    return this.failed;
  }

  get(frame: number): string | undefined {
    return this.cache.get(frame);
  }

  /** 切り出し済みのコマ (昇順) */
  cachedFrames(): number[] {
    return Array.from(this.cache.keys()).sort((a, b) => a - b);
  }

  /** 切り出してほしいコマを優先度順に渡す。前の依頼は捨てる */
  want(frames: number[]): void {
    if (this.disposed || this.failed) return;
    this.wanted = frames.filter((f) => !this.cache.has(f));
    void this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.wanted = [];
    this.video.removeAttribute('src');
    this.video.load();
  }

  private markFailed(): void {
    this.failed = true;
    this.wanted = [];
    this.scheduleNotify();
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled || this.disposed) return;
    this.notifyScheduled = true;
    // 1 枚ごとに描き直すと重いので、1 フレームにまとめて知らせる
    requestAnimationFrame(() => {
      this.notifyScheduled = false;
      if (!this.disposed) this.onUpdate();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.ready)) return;
      while (!this.disposed && !this.failed && this.wanted.length > 0) {
        const frame = this.wanted.shift()!;
        if (this.cache.has(frame)) continue;

        // コマの真ん中を指す (頭ちょうどだと 1 つ前のコマが出ることがある)
        const time = Math.min(Math.max(0, (frame + 0.5) / this.fps), Math.max(0, this.video.duration - 0.001));
        this.video.currentTime = time;
        await waitForEvent(this.video, 'seeked', SEEK_TIMEOUT_MS);
        if (this.disposed) return;

        try {
          this.drawCover();
          this.cache.set(frame, this.canvas.toDataURL('image/jpeg', 0.6));
        } catch {
          // CORS の許可が無い動画を描くと canvas が汚染されて例外になる
          this.markFailed();
          return;
        }
        while (this.cache.size > this.options.maxCache) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) break;
          this.cache.delete(oldest);
        }
        this.scheduleNotify();
      }
    } finally {
      this.running = false;
    }
  }

  /** タイルいっぱいに、縦横比を保って描く (はみ出す分は切る) */
  private drawCover(): void {
    const ctx = this.ctx!;
    const { width, height } = this.options;
    const vw = this.video.videoWidth || width;
    const vh = this.video.videoHeight || height;
    const scale = Math.max(width / vw, height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(this.video, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }
}
