/**
 * Apple ProRes (apch / apcn / apcs / apco / ap4h / ap4x) の .mov を、変換せずにその場で再生するためのデコーダー。
 *
 * - 索引: moov の stsz / stsc / stco(co64) / stts から各コマの位置と時刻を出す (movSampleTable)
 * - 復号: Worker を数本並べ、1 コマずつ SMPTE RDD 36 どおりに復号する (proresBitstream)
 * - 表示中のコマを最優先にし、再生中は先のコマを先読みする
 *
 * ⚠️ 1080p の ProRes 422 HQ は 1 コマ 50ms 前後かかる。Worker 1 本では 24fps に届かないので必ず並べる。
 * ⚠️ ImageBitmap は 1 枚 8MB (1080p) ある。キャッシュ上限を上げすぎないこと。
 */

import { logDebug } from './debugLog';
import { parseMovVideoTrack, readMoov } from './prores/movSampleTable';
import { readFrameHeader } from './prores/proresBitstream';
import type { ProResWorkerRequest, ProResWorkerResponse } from '../workers/proresDecode.worker';

export interface ProResFrameSample {
  offset: number;
  size: number;
  pts: number; // 秒数
  duration: number; // 秒数
}

export interface ProResMetadata {
  fourcc: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  totalFrames: number;
  samples: ProResFrameSample[];
}

/**
 * MOV から ProRes 映像トラックの索引を作る。ProRes が無い・壊れているときは null
 * (呼び出し側は H.264 への変換に回す)。
 */
export async function parseProResMovMetadata(file: File): Promise<ProResMetadata | null> {
  try {
    const moov = await readMoov(file);
    if (!moov) {
      logDebug('roll', `[ProRes] moov が見つかりません: ${file.name}`, undefined, 'warn');
      return null;
    }
    const track = parseMovVideoTrack(moov);
    if (!track) {
      logDebug('roll', `[ProRes] ProRes の映像トラックが見つかりません: ${file.name}`, undefined, 'warn');
      return null;
    }

    const { timescale, sampleTimes, durationUnits } = track;
    const samples: ProResFrameSample[] = track.samples.map((s, i) => {
      const next = i + 1 < sampleTimes.length ? sampleTimes[i + 1] : durationUnits;
      return { offset: s.offset, size: s.size, pts: sampleTimes[i] / timescale, duration: (next - sampleTimes[i]) / timescale };
    });

    // 寸法はコマ自身のヘッダーを正とする (トラック側は表示用に変えてあることがある)
    let { width, height } = track;
    const first = samples[0];
    const head = new Uint8Array(await file.slice(first.offset, first.offset + Math.min(first.size, 64)).arrayBuffer());
    const fh = readFrameHeader(head);
    if (!fh) {
      logDebug('roll', `[ProRes] 1 コマ目が ProRes のフレームとして読めません: ${file.name}`, undefined, 'warn');
      return null;
    }
    width = fh.header.width;
    height = fh.header.height;

    const meta: ProResMetadata = {
      fourcc: track.fourcc,
      width,
      height,
      fps: track.fps,
      duration: durationUnits / timescale,
      totalFrames: samples.length,
      samples,
    };
    logDebug('roll', `[ProRes] 索引: ${meta.fourcc} ${width}x${height} ${meta.totalFrames}コマ ${meta.fps.toFixed(3)}fps ${meta.duration.toFixed(2)}秒`);
    return meta;
  } catch (err) {
    logDebug('roll', `[ProRes] MOV の解析に失敗: ${err instanceof Error ? err.message : err}`, undefined, 'warn');
    return null;
  }
}

type Waiter = (bitmap: ImageBitmap | null) => void;

export class ProResRealtimeDecoder {
  private file: File;
  private metadata: ProResMetadata;
  private workers: Worker[] = [];
  /** Worker ごとの処理中コマ (空きは -1) */
  private workerFrame: number[] = [];
  /** 復号待ちのコマ (先頭ほど優先) */
  private queue: number[] = [];
  private inFlight = new Set<number>();
  private waiters = new Map<number, Waiter[]>();
  private frameCache = new Map<number, ImageBitmap>();
  private readonly maxCacheSize = 30;
  private nextJobId = 1;
  private jobs = new Map<number, { frame: number; worker: number }>();
  private disposed = false;
  private errorLogged = false;

  constructor(file: File, metadata: ProResMetadata) {
    this.file = file;
    this.metadata = metadata;
  }

  public get Meta(): ProResMetadata {
    return this.metadata;
  }

  public get duration(): number {
    return this.metadata.duration;
  }

  public get fps(): number {
    return this.metadata.fps;
  }

  public get frameCount(): number {
    return this.metadata.totalFrames;
  }

  public get width(): number {
    return this.metadata.width;
  }

  public get height(): number {
    return this.metadata.height;
  }

  /** 先読みに使う Worker の本数 */
  public get concurrency(): number {
    return this.workers.length;
  }

  /**
   * Worker を起こし、1 コマ目を実際に復号して確かめる。
   * 失敗 (未対応の形式など) なら false。呼び出し側は変換に回す。
   */
  public async init(): Promise<boolean> {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const count = Math.max(2, Math.min(4, cores - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('../workers/proresDecode.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ProResWorkerResponse>) => this.onWorkerMessage(e.data);
      worker.onerror = (e) => {
        logDebug('roll', `[ProRes] Worker エラー: ${e.message}`, undefined, 'warn');
      };
      const init: ProResWorkerRequest = { type: 'init', file: this.file };
      worker.postMessage(init);
      this.workers.push(worker);
      this.workerFrame.push(-1);
    }

    const started = performance.now();
    const first = await this.getFrame(0);
    if (!first) {
      logDebug('roll', `[ProRes] 1 コマ目の復号に失敗したため、その場再生を諦めます`, undefined, 'warn');
      this.dispose();
      return false;
    }
    logDebug('roll', `[ProRes] その場再生を開始 (Worker ${count} 本、1 コマ目 ${Math.round(performance.now() - started)}ms)`);
    return true;
  }

  /** 指定したコマを最優先で復号して返す。キャッシュにあれば即座に返す */
  public getFrame(frameIndex: number): Promise<ImageBitmap | null> {
    if (this.disposed || this.metadata.totalFrames === 0) return Promise.resolve(null);
    const idx = Math.max(0, Math.min(this.metadata.totalFrames - 1, frameIndex));

    const cached = this.frameCache.get(idx);
    if (cached) {
      // 使った順に並べ直す (古いものから捨てる)
      this.frameCache.delete(idx);
      this.frameCache.set(idx, cached);
      return Promise.resolve(cached);
    }

    return new Promise((resolve) => {
      const list = this.waiters.get(idx);
      if (list) list.push(resolve);
      else this.waiters.set(idx, [resolve]);

      if (!this.inFlight.has(idx)) {
        const at = this.queue.indexOf(idx);
        if (at >= 0) this.queue.splice(at, 1);
        this.queue.unshift(idx);
        this.pump();
      }
    });
  }

  /** キャッシュにあるコマだけを返す (待たない) */
  public peekFrame(frameIndex: number): ImageBitmap | null {
    return this.frameCache.get(frameIndex) ?? null;
  }

  /**
   * from から count コマ先までを先読みする。
   * 範囲外になった先読み (誰も待っていないもの) は取り消す。シーク後に古い先読みで詰まらないように。
   */
  public prefetch(from: number, count: number): void {
    if (this.disposed) return;
    const total = this.metadata.totalFrames;
    const end = Math.min(total, from + count);
    this.queue = this.queue.filter((f) => this.waiters.has(f) || (f >= from && f < end));
    for (let f = Math.max(0, from); f < end; f++) {
      if (this.frameCache.has(f) || this.inFlight.has(f) || this.queue.includes(f)) continue;
      this.queue.push(f);
    }
    this.pump();
  }

  private pump(): void {
    for (let w = 0; w < this.workers.length && this.queue.length > 0; w++) {
      if (this.workerFrame[w] !== -1) continue;
      const frame = this.queue.shift()!;
      if (this.frameCache.has(frame) || this.inFlight.has(frame)) {
        w--;
        continue;
      }
      const sample = this.metadata.samples[frame];
      const id = this.nextJobId++;
      this.jobs.set(id, { frame, worker: w });
      this.workerFrame[w] = frame;
      this.inFlight.add(frame);
      const req: ProResWorkerRequest = { type: 'decode', id, offset: sample.offset, size: sample.size };
      this.workers[w].postMessage(req);
    }
  }

  private onWorkerMessage(msg: ProResWorkerResponse): void {
    const job = this.jobs.get(msg.id);
    if (!job) {
      if (msg.type === 'frame') msg.bitmap.close();
      return;
    }
    this.jobs.delete(msg.id);
    this.workerFrame[job.worker] = -1;
    this.inFlight.delete(job.frame);

    if (this.disposed) {
      if (msg.type === 'frame') msg.bitmap.close();
      return;
    }

    let bitmap: ImageBitmap | null = null;
    if (msg.type === 'frame') {
      bitmap = msg.bitmap;
      this.setCache(job.frame, bitmap);
    } else if (!this.errorLogged) {
      this.errorLogged = true;
      logDebug('roll', `[ProRes] コマ ${job.frame} の復号に失敗: ${msg.message}`, undefined, 'warn');
    }

    const list = this.waiters.get(job.frame);
    this.waiters.delete(job.frame);
    list?.forEach((resolve) => resolve(bitmap));
    this.pump();
  }

  private setCache(frame: number, bitmap: ImageBitmap): void {
    while (this.frameCache.size >= this.maxCacheSize) {
      const oldest = this.frameCache.keys().next().value as number;
      this.frameCache.get(oldest)?.close();
      this.frameCache.delete(oldest);
    }
    this.frameCache.set(frame, bitmap);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.queue = [];
    this.jobs.clear();
    this.inFlight.clear();
    this.waiters.forEach((list) => list.forEach((resolve) => resolve(null)));
    this.waiters.clear();
    this.frameCache.forEach((bitmap) => bitmap.close());
    this.frameCache.clear();
  }
}
