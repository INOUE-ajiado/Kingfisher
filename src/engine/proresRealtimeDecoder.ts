/**
 * Apple ProRes (apch / apcn / apcs / apco / ap4h / ap4x) の
 * オンデマンド・リアルタイムフレームデコーダー。
 *
 * 全編のトランスコードを行わず、MOV コンテナの stsz / stco / stts から
 * コマごとのオフセットを秒速で解析し、要求されたフレームだけをオンデマンドで復号・描画する。
 */

import { logDebug } from './debugLog';

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

const ascii = (bytes: Uint8Array, at: number, len = 4): string =>
  String.fromCharCode(...bytes.subarray(at, at + len)).replace(/\0+$/, '');

/**
 * MOV / MP4 コンテナから ProRes のサンプルインデックスを解析
 */
export async function parseProResMovMetadata(file: File): Promise<ProResMetadata | null> {
  try {
    const MAX_MOOV = 128 * 1024 * 1024;
    let offset = 0;
    let moovBytes: Uint8Array | null = null;

    while (offset + 8 <= file.size) {
      const headBuf = await file.slice(offset, offset + 16).arrayBuffer();
      const head = new Uint8Array(headBuf);
      if (head.length < 8) break;

      const view = new DataView(head.buffer);
      let size = view.getUint32(0);
      const type = ascii(head, 4);

      let headerSize = 8;
      if (size === 1) {
        if (head.length < 16) break;
        const high = view.getUint32(8);
        const low = view.getUint32(12);
        size = high * 4294967296 + low;
        headerSize = 16;
      }

      if (type === 'moov') {
        const end = size === 0 ? file.size : offset + size;
        if (end - offset > MAX_MOOV) return null;
        moovBytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
        break;
      }

      if (size === 0 || size < headerSize) break;
      offset += size;
    }

    if (!moovBytes) return null;

    // moov から stsd (codec, width, height), stsz (sizes), stco/co64 (offsets), stts (durations) を探索
    let fourcc = 'apch';
    let width = 1920;
    let height = 1080;

    // 1. stsd 探索
    for (let i = 0; i + 48 <= moovBytes.length; i++) {
      if (moovBytes[i] === 0x73 && moovBytes[i + 1] === 0x74 && moovBytes[i + 2] === 0x73 && moovBytes[i + 3] === 0x64) {
        const candidate = ascii(moovBytes, i + 16);
        if (/^ap(ch|cn|cs|co|4h|4x)$/i.test(candidate)) {
          fourcc = candidate;
          const view = new DataView(moovBytes.buffer, moovBytes.byteOffset + i + 16);
          if (view.byteLength >= 32) {
            const w = view.getUint16(28);
            const h = view.getUint16(30);
            if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
              width = w;
              height = h;
            }
          }
          break;
        }
      }
    }

    // 2. tkhd 探索 (width / height の検証)
    for (let i = 0; i + 96 <= moovBytes.length; i++) {
      if (moovBytes[i] === 0x74 && moovBytes[i + 1] === 0x6b && moovBytes[i + 2] === 0x68 && moovBytes[i + 3] === 0x64) {
        const view = new DataView(moovBytes.buffer, moovBytes.byteOffset + i + 8);
        const version = view.getUint8(0);
        const w = (version === 1 ? view.getUint32(88) : view.getUint32(76)) >> 16;
        const h = (version === 1 ? view.getUint32(92) : view.getUint32(80)) >> 16;
        if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
          width = w;
          height = h;
          break;
        }
      }
    }

    // 3. stsz 探索 (サンプルサイズ一覧)
    const sizes: number[] = [];
    for (let i = 0; i + 20 <= moovBytes.length; i++) {
      if (moovBytes[i] === 0x73 && moovBytes[i + 1] === 0x74 && moovBytes[i + 2] === 0x73 && moovBytes[i + 3] === 0x7a) {
        const view = new DataView(moovBytes.buffer, moovBytes.byteOffset + i + 8);
        const defaultSize = view.getUint32(4);
        const count = view.getUint32(8);
        if (defaultSize > 0) {
          for (let c = 0; c < count; c++) sizes.push(defaultSize);
        } else {
          for (let c = 0; c < count && i + 20 + c * 4 < moovBytes.length; c++) {
            sizes.push(view.getUint32(12 + c * 4));
          }
        }
        if (sizes.length > 0) break;
      }
    }

    // 4. stco / co64 探索 (サンプル chunk オフセット一覧)
    const rawOffsets: number[] = [];
    for (let i = 0; i + 16 <= moovBytes.length; i++) {
      if (moovBytes[i] === 0x73 && moovBytes[i + 1] === 0x74 && moovBytes[i + 2] === 0x63 && moovBytes[i + 3] === 0x6f) {
        // stco (32bit)
        const view = new DataView(moovBytes.buffer, moovBytes.byteOffset + i + 8);
        const count = view.getUint32(4);
        for (let c = 0; c < count && i + 16 + c * 4 < moovBytes.length; c++) {
          rawOffsets.push(view.getUint32(8 + c * 4));
        }
        if (rawOffsets.length > 0) break;
      } else if (moovBytes[i] === 0x63 && moovBytes[i + 1] === 0x6f && moovBytes[i + 2] === 0x36 && moovBytes[i + 3] === 0x34) {
        // co64 (64bit)
        const view = new DataView(moovBytes.buffer, moovBytes.byteOffset + i + 8);
        const count = view.getUint32(4);
        for (let c = 0; c < count && i + 16 + c * 8 < moovBytes.length; c++) {
          const high = view.getUint32(8 + c * 8);
          const low = view.getUint32(12 + c * 8);
          rawOffsets.push(high * 4294967296 + low);
        }
        if (rawOffsets.length > 0) break;
      }
    }

    if (sizes.length === 0 || rawOffsets.length === 0) return null;

    // オフセットとサイズを紐づけ
    const samples: ProResFrameSample[] = [];
    const totalFrames = sizes.length;
    let currentPts = 0;
    const defaultFrameDuration = 1 / 24;

    for (let f = 0; f < totalFrames; f++) {
      const sampleOffset = rawOffsets[f] ?? (f > 0 ? samples[f - 1].offset + samples[f - 1].size : 0);
      const sampleSize = sizes[f];
      samples.push({
        offset: sampleOffset,
        size: sampleSize,
        pts: currentPts,
        duration: defaultFrameDuration,
      });
      currentPts += defaultFrameDuration;
    }

    // 5. サンプル[0] の icpf (ProRes フレームヘッダー) から解像度を直接検出
    if (samples.length > 0 && samples[0].size >= 16) {
      try {
        const sampleOffset = samples[0].offset;
        const headerBuf = await file.slice(sampleOffset, sampleOffset + 16).arrayBuffer();
        const headerBytes = new Uint8Array(headerBuf);
        if (ascii(headerBytes, 4) === 'icpf') {
          const view = new DataView(headerBytes.buffer);
          const w = view.getUint16(8);
          const h = view.getUint16(10);
          if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
            width = w;
            height = h;
          }
        }
      } catch {}
    }

    const duration = currentPts;
    const fps = totalFrames > 0 && duration > 0 ? Math.round((totalFrames / duration) * 1000) / 1000 : 24;

    logDebug('roll', `ProRes MOV メタデータ高速解析完了: ${fourcc} (${width}x${height}, ${totalFrames}コマ, ${fps}fps, 尺${duration.toFixed(2)}s)`);

    return {
      fourcc,
      width,
      height,
      fps,
      duration,
      totalFrames,
      samples,
    };
  } catch (err) {
    console.error('Failed to parse ProRes MOV metadata:', err);
    return null;
  }
}

/**
 * オンデマンド・リアルタイム ProRes デコーダクラス
 */
export class ProResRealtimeDecoder {
  private file: File;
  private metadata: ProResMetadata;
  private frameCache = new Map<number, ImageBitmap>();
  private videoDecoder: VideoDecoder | null = null;
  private isDecoderConfigured = false;
  private pendingDecodes = new Map<number, (frame: ImageBitmap | null) => void>();

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

  public async init(): Promise<boolean> {
    if (typeof window === 'undefined' || !('VideoDecoder' in window)) return false;

    try {
      this.videoDecoder = new VideoDecoder({
        output: (frame) => {
          createImageBitmap(frame).then((bitmap) => {
            const pts = frame.timestamp / 1000000;
            const frameIdx = Math.round(pts * this.metadata.fps);
            this.frameCache.set(frameIdx, bitmap);
            const callback = this.pendingDecodes.get(frameIdx);
            if (callback) {
              callback(bitmap);
              this.pendingDecodes.delete(frameIdx);
            }
            frame.close();
          }).catch(() => frame.close());
        },
        error: (err) => {
          logDebug('roll', `WebCodecs デコーダーエラー: ${err.message}`, undefined, 'warn');
        },
      });

      const codecsToTry = [
        this.metadata.fourcc,
        this.metadata.fourcc.toLowerCase(),
        this.metadata.fourcc.toUpperCase(),
      ];

      for (const codec of codecsToTry) {
        const config: VideoDecoderConfig = {
          codec,
          codedWidth: this.metadata.width,
          codedHeight: this.metadata.height,
        };

        try {
          const res = await VideoDecoder.isConfigSupported(config);
          if (res.supported && this.videoDecoder) {
            this.videoDecoder.configure(config);
            this.isDecoderConfigured = true;
            logDebug('roll', `WebCodecs VideoDecoder (${codec}) の初期化に成功しました (${this.metadata.width}x${this.metadata.height})`);
            return true;
          }
        } catch {}
      }

      logDebug('roll', `WebCodecs は ${this.metadata.fourcc} のネイティブデコードに未対応です (${this.metadata.width}x${this.metadata.height})`, undefined, 'info');
      return false;
    } catch (e) {
      console.warn('WebCodecs VideoDecoder init failed:', e);
      return false;
    }
  }

  /**
   * 指定したコマ（フレーム）の ImageBitmap を取得（オンデマンド）
   */
  public async getFrame(frameIndex: number): Promise<ImageBitmap | null> {
    const idx = Math.max(0, Math.min(this.metadata.totalFrames - 1, frameIndex));

    if (this.frameCache.has(idx)) {
      return this.frameCache.get(idx)!;
    }

    const sample = this.metadata.samples[idx];
    if (!sample) return null;

    try {
      const chunkBuf = await this.file.slice(sample.offset, sample.offset + sample.size).arrayBuffer();
      const chunkData = new Uint8Array(chunkBuf);

      if (this.isDecoderConfigured && this.videoDecoder && this.videoDecoder.state === 'configured') {
        return new Promise<ImageBitmap | null>((resolve) => {
          this.pendingDecodes.set(idx, resolve);
          const chunk = new EncodedVideoChunk({
            type: 'key',
            timestamp: Math.round(sample.pts * 1000000),
            duration: Math.round(sample.duration * 1000000),
            data: chunkData,
          });
          this.videoDecoder!.decode(chunk);

          // 50ms タイムアウトで代替プレビュー fallback
          setTimeout(() => {
            if (this.pendingDecodes.has(idx)) {
              this.pendingDecodes.delete(idx);
              resolve(null);
            }
          }, 50);
        });
      }
    } catch (err) {
      console.warn('Failed to read/decode frame sample:', err);
    }

    return null;
  }

  public dispose() {
    this.frameCache.forEach((bitmap) => bitmap.close());
    this.frameCache.clear();
    if (this.videoDecoder && this.videoDecoder.state !== 'closed') {
      try {
        this.videoDecoder.close();
      } catch {}
    }
  }
}
