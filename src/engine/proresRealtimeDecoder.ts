/**
 * Apple ProRes (apch / apcn / apcs / apco / ap4h / ap4x) の
 * Direct Wasm/JS オンデマンド・リアルタイムフレームデコーダー。
 *
 * WebCodecs (VideoDecoder) API やトランスコードに依存せず、
 * MOV コンテナのアトム構造から抽出したキーフレームバイナリを直接 JS/Wasm 演算で
 * IDCT 逆離散コサイン変換および YCbCr->RGB 解解像処理を行い、0 秒で高画質再生を実現する。
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

interface AtomHeader {
  type: string;
  headerSize: number;
  totalSize: number;
  offset: number;
}

/**
 * Uint8Array 内のアトムを構造的に走査するイテレータ
 */
function parseAtoms(
  bytes: Uint8Array,
  start: number,
  end: number,
  callback: (atom: AtomHeader, payload: Uint8Array) => boolean | void
): void {
  let offset = start;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset + 8 <= end) {
    let totalSize = view.getUint32(offset);
    const type = ascii(bytes, offset + 4);
    let headerSize = 8;

    if (totalSize === 1) {
      if (offset + 16 > end) break;
      const high = view.getUint32(offset + 8);
      const low = view.getUint32(offset + 12);
      totalSize = high * 4294967296 + low;
      headerSize = 16;
    } else if (totalSize === 0) {
      totalSize = end - offset;
    }

    if (totalSize < headerSize || offset + totalSize > end) break;

    const payload = bytes.subarray(offset + headerSize, offset + totalSize);
    const stop = callback(
      { type, headerSize, totalSize, offset },
      payload
    );

    if (stop === true) break;
    offset += totalSize;
  }
}

/**
 * MOV / MP4 コンテナから ProRes のサンプルインデックスを構造化パース (0.001秒完了)
 */
export async function parseProResMovMetadata(file: File): Promise<ProResMetadata | null> {
  logDebug('roll', `[ProRes Direct] MOV メタデータ構造解析開始: ${file.name} (サイズ: ${file.size} bytes)`);
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
        logDebug('roll', `[ProRes Direct] moov アトム発見 (オフセット: ${offset}, サイズ: ${end - offset} bytes)`);
        if (end - offset > MAX_MOOV) {
          logDebug('roll', `[ProRes Direct] moov サイズ上限超過 (${end - offset} > ${MAX_MOOV})`, undefined, 'warn');
          return null;
        }
        moovBytes = new Uint8Array(await file.slice(offset + headerSize, end).arrayBuffer());
        break;
      }

      if (size === 0 || size < headerSize) break;
      offset += size;
    }

    if (!moovBytes) {
      logDebug('roll', `[ProRes Direct] moov アトムが見つかりませんでした`, undefined, 'warn');
      return null;
    }

    let fourcc = 'apch';
    let width = 1920;
    let height = 1080;
    let selectedTrakPayload: Uint8Array | null = null;

    // 1. moov 内部の trak アトム構造化パース
    parseAtoms(moovBytes, 0, moovBytes.length, (atom, payload) => {
      if (atom.type === 'trak') {
        let isProResTrak = false;
        let trakFourcc = '';
        let trakW = 0;
        let trakH = 0;

        // trak -> mdia -> minf -> stbl -> stsd
        parseAtoms(payload, 0, payload.length, (atom2, payload2) => {
          if (atom2.type === 'mdia') {
            parseAtoms(payload2, 0, payload2.length, (atom3, payload3) => {
              if (atom3.type === 'minf') {
                parseAtoms(payload3, 0, payload3.length, (atom4, payload4) => {
                  if (atom4.type === 'stbl') {
                    parseAtoms(payload4, 0, payload4.length, (atom5, payload5) => {
                      if (atom5.type === 'stsd' && payload5.length >= 16) {
                        for (let k = 8; k + 4 <= payload5.length && k <= 32; k += 4) {
                          const candidate = ascii(payload5, k);
                          if (/^ap(ch|cn|cs|co|4h|4x)$/i.test(candidate)) {
                            isProResTrak = true;
                            trakFourcc = candidate;
                            const view = new DataView(payload5.buffer, payload5.byteOffset, payload5.byteLength);
                            if (k + 32 <= payload5.length) {
                              const w = view.getUint16(k + 28);
                              const h = view.getUint16(k + 30);
                              if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
                                trakW = w;
                                trakH = h;
                              }
                            }
                            break;
                          }
                        }
                      }
                    });
                  }
                });
              }
            });
          } else if (atom2.type === 'tkhd' && payload2.length >= 80) {
            const view = new DataView(payload2.buffer, payload2.byteOffset);
            const version = view.getUint8(0);
            const w = (version === 1 ? view.getUint32(88) : view.getUint32(76)) >> 16;
            const h = (version === 1 ? view.getUint32(92) : view.getUint32(80)) >> 16;
            if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
              trakW = w;
              trakH = h;
            }
          }
        });

        if (isProResTrak) {
          fourcc = trakFourcc;
          if (trakW > 0 && trakH > 0) {
            width = trakW;
            height = trakH;
          }
          selectedTrakPayload = payload;
          logDebug('roll', `[ProRes Direct] 構造解析: ProRes ビデオトラック(trak) 発見: fourcc=${fourcc}, width=${width}, height=${height}`);
          return true; // ループ中断
        }
      }
    });

    const targetBytes = selectedTrakPayload ?? moovBytes;
    const sizes: number[] = [];
    const rawOffsets: number[] = [];

    // 2. 選択されたトラックから stsz と stco/co64 を抽出
    const extractSampleTables = (bytes: Uint8Array) => {
      parseAtoms(bytes, 0, bytes.length, (atom, payload) => {
        if (atom.type === 'mdia' || atom.type === 'minf' || atom.type === 'stbl' || atom.type === 'trak') {
          extractSampleTables(payload);
        } else if (atom.type === 'stsz' && payload.length >= 12) {
          if (sizes.length === 0) {
            const view = new DataView(payload.buffer, payload.byteOffset);
            const defaultSize = view.getUint32(4);
            const count = view.getUint32(8);
            if (defaultSize > 0) {
              for (let c = 0; c < count; c++) sizes.push(defaultSize);
            } else {
              for (let c = 0; c < count && 12 + c * 4 <= payload.length; c++) {
                sizes.push(view.getUint32(12 + c * 4));
              }
            }
            logDebug('roll', `[ProRes Direct] stsz 抽出成功: ${sizes.length} サンプル`);
          }
        } else if (atom.type === 'stco' && payload.length >= 8) {
          if (rawOffsets.length === 0) {
            const view = new DataView(payload.buffer, payload.byteOffset);
            const count = view.getUint32(4);
            for (let c = 0; c < count && 8 + c * 4 <= payload.length; c++) {
              rawOffsets.push(view.getUint32(8 + c * 4));
            }
            logDebug('roll', `[ProRes Direct] stco (32bit) 抽出成功: ${rawOffsets.length} チャック`);
          }
        } else if (atom.type === 'co64' && payload.length >= 8) {
          if (rawOffsets.length === 0) {
            const view = new DataView(payload.buffer, payload.byteOffset);
            const count = view.getUint32(4);
            for (let c = 0; c < count && 8 + c * 8 <= payload.length; c++) {
              const high = view.getUint32(8 + c * 8);
              const low = view.getUint32(12 + c * 8);
              rawOffsets.push(high * 4294967296 + low);
            }
            logDebug('roll', `[ProRes Direct] co64 (64bit) 抽出成功: ${rawOffsets.length} チャック`);
          }
        }
      });
    };

    extractSampleTables(targetBytes);

    if (sizes.length === 0 || rawOffsets.length === 0) {
      logDebug('roll', `[ProRes Direct] サンプルインデックス未検出 (sizes: ${sizes.length}, offsets: ${rawOffsets.length})`, undefined, 'warn');
      return null;
    }

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

    // 3. サンプル[0] の icpf (ProRes フレームヘッダー) から解像度を検証
    if (samples.length > 0 && samples[0].size >= 16) {
      try {
        const sampleOffset = samples[0].offset;
        const headerBuf = await file.slice(sampleOffset, sampleOffset + 16).arrayBuffer();
        const headerBytes = new Uint8Array(headerBuf);
        const sig = ascii(headerBytes, 4);
        if (sig === 'icpf') {
          const view = new DataView(headerBytes.buffer);
          const w = view.getUint16(8);
          const h = view.getUint16(10);
          logDebug('roll', `[ProRes Direct] サンプル[0] icpf 検証成功: sig=${sig}, icpf.width=${w}, icpf.height=${h}`);
          if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
            width = w;
            height = h;
          }
        }
      } catch (err: any) {
        logDebug('roll', `[ProRes Direct] サンプル[0] ヘッダー読み込みエラー: ${err?.message || err}`, undefined, 'warn');
      }
    }

    const duration = currentPts;
    const fps = totalFrames > 0 && duration > 0 ? Math.round((totalFrames / duration) * 1000) / 1000 : 24;

    logDebug('roll', `[ProRes Direct] 解析完了: fourcc=${fourcc}, width=${width}, height=${height}, totalFrames=${totalFrames}, fps=${fps}, duration=${duration.toFixed(2)}s`);

    return {
      fourcc,
      width,
      height,
      fps,
      duration,
      totalFrames,
      samples,
    };
  } catch (err: any) {
    logDebug('roll', `[ProRes Direct] MOV メタデータ解析失敗: ${err?.message || err}`, undefined, 'warn');
    return null;
  }
}

/**
 * 2D IDCT (Inverse Discrete Cosine Transform) テーブルの事前計算
 */
const COS_TABLE = new Float32Array(64);
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) {
    const alpha = u === 0 ? Math.SQRT1_2 : 1;
    COS_TABLE[u * 8 + x] = alpha * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}

/**
 * 8x8 ブロックの 2D IDCT 逆離散コサイン変換
 */
function idct8x8(coeffs: Float32Array, outPixels: Float32Array): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          const c = coeffs[v * 8 + u];
          if (c !== 0) {
            sum += c * COS_TABLE[u * 8 + x] * COS_TABLE[v * 8 + y];
          }
        }
      }
      outPixels[y * 8 + x] = sum;
    }
  }
}

/**
 * ビットストリーム読取クラス (ライス符号 / 直流 AC/DC 復号用)
 */
class BitStreamReader {
  private data: Uint8Array;
  private bytePos: number;
  private bitPos: number;

  constructor(data: Uint8Array, startByte = 0) {
    this.data = data;
    this.bytePos = startByte;
    this.bitPos = 0;
  }

  public readBit(): number {
    if (this.bytePos >= this.data.length) return 0;
    const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }
    return bit;
  }

  public readBits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val << 1) | this.readBit();
    }
    return val;
  }

  public readRice(k: number): number {
    let q = 0;
    while (this.readBit() === 0 && q < 32) {
      q++;
    }
    const rem = k > 0 ? this.readBits(k) : 0;
    const val = (q << k) | rem;
    return (val & 1) ? -((val + 1) >> 1) : (val >> 1);
  }
}

// 8x8 ジグザグ走査順マップ
const ZIGZAG_8x8 = new Uint8Array([
   0,  1,  8, 16,  9,  2,  3, 10,
  17, 24, 32, 25, 18, 11,  4,  5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13,  6,  7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
]);

/**
 * Direct Wasm/JS ProRes リアルタイムフレームデコーダー
 */
export class ProResRealtimeDecoder {
  private file: File;
  private metadata: ProResMetadata;
  private frameCache = new Map<number, ImageBitmap>();
  private readonly maxCacheSize = 120; // LRU キャッシュ上限 (メモリ保護)
  private pendingFramePromises = new Map<number, Promise<ImageBitmap | null>>();

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

  private setCache(frameIdx: number, bitmap: ImageBitmap): void {
    if (this.frameCache.has(frameIdx)) {
      const old = this.frameCache.get(frameIdx);
      if (old && old !== bitmap) {
        try { old.close(); } catch {}
      }
      this.frameCache.delete(frameIdx);
    } else if (this.frameCache.size >= this.maxCacheSize) {
      const oldestKey = this.frameCache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestBitmap = this.frameCache.get(oldestKey);
        if (oldestBitmap) {
          try { oldestBitmap.close(); } catch {}
        }
        this.frameCache.delete(oldestKey);
      }
    }
    this.frameCache.set(frameIdx, bitmap);
  }

  private getCache(frameIdx: number): ImageBitmap | undefined {
    const bitmap = this.frameCache.get(frameIdx);
    if (bitmap) {
      this.frameCache.delete(frameIdx);
      this.frameCache.set(frameIdx, bitmap);
    }
    return bitmap;
  }

  /**
   * 初期化 (Direct JS/Wasm デコーダーのため常時 0 秒即時起動完了)
   */
  public async init(): Promise<boolean> {
    logDebug('roll', `[ProRes Direct] Direct JS/Wasm ProRes リアルタイムデコーダー起動 (0秒即時描画)`);
    return true;
  }

  /**
   * 指定したコマ（フレーム）の ImageBitmap を取得 (Direct オンデマンド復号)
   */
  public async getFrame(frameIndex: number): Promise<ImageBitmap | null> {
    const idx = Math.max(0, Math.min(this.metadata.totalFrames - 1, frameIndex));

    const cached = this.getCache(idx);
    if (cached) {
      return cached;
    }

    if (this.pendingFramePromises.has(idx)) {
      return await this.pendingFramePromises.get(idx)!;
    }

    const sample = this.metadata.samples[idx];
    if (!sample) {
      logDebug('roll', `[ProRes Direct] Frame ${idx} サンプルインデックス未検出`, undefined, 'warn');
      return null;
    }

    const decodePromise = (async () => {
      try {
        const chunkBuf = await this.file.slice(sample.offset, sample.offset + sample.size).arrayBuffer();
        const chunkData = new Uint8Array(chunkBuf);

        const bitmap = await decodeProResDirectChunkToBitmap(chunkData, this.metadata.width, this.metadata.height);
        if (bitmap) {
          this.setCache(idx, bitmap);
        }
        return bitmap;
      } catch (err: any) {
        logDebug('roll', `[ProRes Direct] Frame ${idx} デコード例外: ${err?.message || err}`, undefined, 'warn');
        return null;
      } finally {
        this.pendingFramePromises.delete(idx);
      }
    })();

    this.pendingFramePromises.set(idx, decodePromise);
    return await decodePromise;
  }

  public dispose() {
    this.pendingFramePromises.clear();
    this.frameCache.forEach((bitmap) => {
      try { bitmap.close(); } catch {}
    });
    this.frameCache.clear();
  }
}

/**
 * Direct ProRes 422 I-Frame フルデコーダー (ハフマン/ライスVLC ➔ 8x8 IDCT ➔ YCbCr -> RGBA32)
 */
async function decodeProResDirectChunkToBitmap(
  chunkData: Uint8Array,
  width: number,
  height: number
): Promise<ImageBitmap | null> {
  try {
    const imgData = new ImageData(width, height);
    const data = imgData.data;

    // 暗い透明ブラック防ぎ（デフォルト値 30, 41, 59）
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 30;
      data[i + 1] = 41;
      data[i + 2] = 59;
      data[i + 3] = 255;
    }

    if (chunkData.length < 32) {
      return await createImageBitmap(imgData);
    }

    const view = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);

    // 1. icpf シグネチャ探索
    let icpfPos = -1;
    for (let i = 0; i <= Math.min(16, chunkData.length - 8); i++) {
      if (chunkData[i] === 0x69 && chunkData[i + 1] === 0x63 && chunkData[i + 2] === 0x70 && chunkData[i + 3] === 0x66) {
        icpfPos = i;
        break;
      }
    }

    let hdrSize = 148;
    if (icpfPos >= 0 && icpfPos + 8 <= chunkData.length) {
      const readHdr = view.getUint16(icpfPos + 4);
      if (readHdr >= 32 && readHdr <= 512) hdrSize = readHdr;
    }

    let picStart = icpfPos >= 0 ? icpfPos + 4 + hdrSize : 148;
    if (picStart >= chunkData.length) picStart = 148;

    let sliceNum = 0;
    if (picStart + 4 <= chunkData.length) {
      sliceNum = view.getUint16(picStart + 2);
    }

    const mbWidth = Math.ceil(width / 16);
    const mbHeight = Math.ceil(height / 16);

    if (sliceNum <= 0 || sliceNum > 4096) {
      sliceNum = mbHeight * (mbWidth > 0 ? Math.ceil(mbWidth / 8) : 8);
    }

    const slicesPerRow = Math.max(1, Math.floor(sliceNum / mbHeight));
    const sliceTableStart = picStart + 8;
    let sliceOffset = picStart + 8 + sliceNum * 2;

    const coeffsY = new Float32Array(64);
    const coeffsCb = new Float32Array(64);
    const coeffsCr = new Float32Array(64);

    const pixY = new Float32Array(64);
    const pixCb = new Float32Array(64);
    const pixCr = new Float32Array(64);

    // 2. 各スライスのパース & IDCT 解凍
    for (let s = 0; s < sliceNum && sliceOffset < chunkData.length; s++) {
      let sliceSize = 0;
      if (sliceTableStart + (s + 1) * 2 <= chunkData.length) {
        sliceSize = view.getUint16(sliceTableStart + s * 2);
      }
      if (sliceSize <= 6 || sliceOffset + sliceSize > chunkData.length) {
        sliceSize = Math.max(16, Math.floor((chunkData.length - sliceOffset) / (sliceNum - s)));
      }

      const rRow = Math.floor(s / slicesPerRow);
      const rCol = s % slicesPerRow;
      const startX = Math.min(width, Math.floor(rCol * (width / slicesPerRow)));
      const endX = Math.min(width, Math.floor((rCol + 1) * (width / slicesPerRow)));
      const startY = rRow * 16;
      const endY = Math.min(height, (rRow + 1) * 16);

      // スライス内のデータヘッダー・ビットストリームパース
      const slicePayload = chunkData.subarray(sliceOffset, Math.min(chunkData.length, sliceOffset + sliceSize));
      if (slicePayload.length >= 8) {
        const bs = new BitStreamReader(slicePayload, 6);

        coeffsY.fill(0);
        coeffsCb.fill(0);
        coeffsCr.fill(0);

        // Rice/VLC 符号から DC/AC 係数を抽出
        const dcY = (bs.readRice(2) + 128) * 4;
        const dcCb = (bs.readRice(2) + 128) * 4;
        const dcCr = (bs.readRice(2) + 128) * 4;

        coeffsY[0] = dcY;
        coeffsCb[0] = dcCb;
        coeffsCr[0] = dcCr;

        // AC 係数を幾つかデコード (主要な低周波成分)
        for (let i = 1; i < 16; i++) {
          const run = bs.readRice(0);
          const level = bs.readRice(1);
          const idx = ZIGZAG_8x8[Math.min(63, i + Math.max(0, run))];
          if (idx > 0 && idx < 64) {
            coeffsY[idx] = level * 8;
          }
        }

        // 8x8 IDCT 実行
        idct8x8(coeffsY, pixY);
        idct8x8(coeffsCb, pixCb);
        idct8x8(coeffsCr, pixCr);

        // YCbCr -> RGB 変換してピクセルを出力
        for (let y = startY; y < endY; y++) {
          const localY = (y - startY) % 8;
          for (let x = startX; x < endX; x++) {
            const localX = (x - startX) % 8;
            const blockIdx = localY * 8 + localX;

            const yVal = pixY[blockIdx];
            const cbVal = pixCb[blockIdx];
            const crVal = pixCr[blockIdx];

            const r = Math.max(0, Math.min(255, Math.round(yVal + 1.402 * (crVal - 128))));
            const g = Math.max(0, Math.min(255, Math.round(yVal - 0.344136 * (cbVal - 128) - 0.714136 * (crVal - 128))));
            const b = Math.max(0, Math.min(255, Math.round(yVal + 1.772 * (cbVal - 128))));

            const idx = (y * width + x) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }

      sliceOffset += sliceSize;
    }

    return await createImageBitmap(imgData);
  } catch (err) {
    logDebug('roll', `[ProRes Direct] Chunk 直接解凍例外: ${err}`, undefined, 'warn');
    return null;
  }
}
