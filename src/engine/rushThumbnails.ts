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
