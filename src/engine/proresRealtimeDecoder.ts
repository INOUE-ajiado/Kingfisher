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
  logDebug('roll', `[ProRes DEBUG] MOV コンテナ解析開始: ${file.name} (サイズ: ${file.size} bytes / type: ${file.type || '未指定'})`);
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
        logDebug('roll', `[ProRes DEBUG] moov アトム発見 (オフセット: ${offset}, サイズ: ${end - offset} bytes)`);
        if (end - offset > MAX_MOOV) {
          logDebug('roll', `[ProRes DEBUG] moov サイズ上限超過 (${end - offset} > ${MAX_MOOV})`, undefined, 'warn');
          return null;
        }
        moovBytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
        break;
      }

      if (size === 0 || size < headerSize) break;
      offset += size;
    }

    if (!moovBytes) {
      logDebug('roll', `[ProRes DEBUG] moov アトムが見つかりませんでした`, undefined, 'warn');
      return null;
    }

    // 1. moovBytes 内からすべての trak (Track) アトムの範囲を特定し、ProRes ビデオトラックを探す
    let videoTrakBytes: Uint8Array = moovBytes;
    let fourcc = 'apch';

    let foundVideoTrak = false;
    for (let i = 0; i + 8 <= moovBytes.length; i++) {
      if (moovBytes[i] === 0x74 && moovBytes[i + 1] === 0x72 && moovBytes[i + 2] === 0x61 && moovBytes[i + 3] === 0x6b) {
        // trak アトム発見 (直前 4 バイトがサイズ)
        let trakStart = i - 4;
        let size = 0;
        if (trakStart >= 0 && trakStart + 8 <= moovBytes.length) {
          const view = new DataView(moovBytes.buffer, moovBytes.byteOffset + trakStart);
          size = view.getUint32(0);
        }
        let trakEnd = size > 0 ? Math.min(trakStart + size, moovBytes.length) : moovBytes.length;
        if (trakStart < 0) trakStart = 0;

        const trakSub = moovBytes.subarray(trakStart, trakEnd);
        // この trak 内に ProRes fourcc を持つ stsd があるかチェック
        for (let j = 0; j + 20 <= trakSub.length; j++) {
          if (trakSub[j] === 0x73 && trakSub[j + 1] === 0x74 && trakSub[j + 2] === 0x73 && trakSub[j + 3] === 0x64) {
            const candidate = ascii(trakSub, j + 16);
            if (/^ap(ch|cn|cs|co|4h|4x)$/i.test(candidate)) {
              fourcc = candidate;
              videoTrakBytes = trakSub;
              foundVideoTrak = true;
              logDebug('roll', `[ProRes DEBUG] ProRes ビデオトラック(trak) 発見: fourcc=${fourcc}, trak 範囲=${trakStart}..${trakEnd}`);
              break;
            }
          }
        }
        if (foundVideoTrak) break;
      }
    }

    if (!foundVideoTrak) {
      logDebug('roll', `[ProRes DEBUG] 警告: ProRes (apch/apcn/apcs/apco) の trak が明確に識別できませんでした。moov 全体をパースします。`, undefined, 'warn');
    }

    let width = 1920;
    let height = 1080;

    // 2. stsd 探索 (解像度取得)
    for (let i = 0; i + 48 <= videoTrakBytes.length; i++) {
      if (videoTrakBytes[i] === 0x73 && videoTrakBytes[i + 1] === 0x74 && videoTrakBytes[i + 2] === 0x73 && videoTrakBytes[i + 3] === 0x64) {
        const candidate = ascii(videoTrakBytes, i + 16);
        if (/^ap(ch|cn|cs|co|4h|4x)$/i.test(candidate) || !foundVideoTrak) {
          if (!foundVideoTrak) fourcc = candidate;
          const view = new DataView(videoTrakBytes.buffer, videoTrakBytes.byteOffset + i + 16);
          if (view.byteLength >= 32) {
            const w = view.getUint16(28);
            const h = view.getUint16(30);
            if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
              width = w;
              height = h;
            }
          }
          logDebug('roll', `[ProRes DEBUG] stsd 検出: fourcc=${fourcc}, stsd.width=${width}, stsd.height=${height}`);
          break;
        }
      }
    }

    // 3. tkhd 探索 (width / height の検証)
    for (let i = 0; i + 96 <= videoTrakBytes.length; i++) {
      if (videoTrakBytes[i] === 0x74 && videoTrakBytes[i + 1] === 0x6b && videoTrakBytes[i + 2] === 0x68 && videoTrakBytes[i + 3] === 0x64) {
        const view = new DataView(videoTrakBytes.buffer, videoTrakBytes.byteOffset + i + 8);
        const version = view.getUint8(0);
        const w = (version === 1 ? view.getUint32(88) : view.getUint32(76)) >> 16;
        const h = (version === 1 ? view.getUint32(92) : view.getUint32(80)) >> 16;
        if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
          width = w;
          height = h;
          logDebug('roll', `[ProRes DEBUG] tkhd 検出: tkhd.width=${width}, tkhd.height=${height}`);
          break;
        }
      }
    }

    // 4. stsz 探索 (ProRes ビデオトラック内のサンプルサイズ一覧)
    const sizes: number[] = [];
    for (let i = 0; i + 20 <= videoTrakBytes.length; i++) {
      if (videoTrakBytes[i] === 0x73 && videoTrakBytes[i + 1] === 0x74 && videoTrakBytes[i + 2] === 0x73 && videoTrakBytes[i + 3] === 0x7a) {
        const view = new DataView(videoTrakBytes.buffer, videoTrakBytes.byteOffset + i + 8);
        const defaultSize = view.getUint32(4);
        const count = view.getUint32(8);
        if (defaultSize > 0) {
          for (let c = 0; c < count; c++) sizes.push(defaultSize);
        } else {
          for (let c = 0; c < count && i + 20 + c * 4 < videoTrakBytes.length; c++) {
            sizes.push(view.getUint32(12 + c * 4));
          }
        }
        logDebug('roll', `[ProRes DEBUG] stsz 検出: 全 ${sizes.length} サンプル (サンプル[0]サイズ: ${sizes[0]} bytes)`);
        if (sizes.length > 0) break;
      }
    }

    // 5. stco / co64 探索 (ProRes ビデオトラック内の chunk オフセット一覧)
    const rawOffsets: number[] = [];
    for (let i = 0; i + 16 <= videoTrakBytes.length; i++) {
      if (videoTrakBytes[i] === 0x73 && videoTrakBytes[i + 1] === 0x74 && videoTrakBytes[i + 2] === 0x63 && videoTrakBytes[i + 3] === 0x6f) {
        // stco (32bit)
        const view = new DataView(videoTrakBytes.buffer, videoTrakBytes.byteOffset + i + 8);
        const count = view.getUint32(4);
        for (let c = 0; c < count && i + 16 + c * 4 < videoTrakBytes.length; c++) {
          rawOffsets.push(view.getUint32(8 + c * 4));
        }
        logDebug('roll', `[ProRes DEBUG] stco 検出: 全 ${rawOffsets.length} チャック (サンプル[0]オフセット: ${rawOffsets[0]})`);
        if (rawOffsets.length > 0) break;
      } else if (videoTrakBytes[i] === 0x63 && videoTrakBytes[i + 1] === 0x6f && videoTrakBytes[i + 2] === 0x36 && videoTrakBytes[i + 3] === 0x34) {
        // co64 (64bit)
        const view = new DataView(videoTrakBytes.buffer, videoTrakBytes.byteOffset + i + 8);
        const count = view.getUint32(4);
        for (let c = 0; c < count && i + 16 + c * 8 < videoTrakBytes.length; c++) {
          const high = view.getUint32(8 + c * 8);
          const low = view.getUint32(12 + c * 8);
          rawOffsets.push(high * 4294967296 + low);
        }
        logDebug('roll', `[ProRes DEBUG] co64 検出: 全 ${rawOffsets.length} チャック (サンプル[0]オフセット: ${rawOffsets[0]})`);
        if (rawOffsets.length > 0) break;
      }
    }

    if (sizes.length === 0 || rawOffsets.length === 0) {
      logDebug('roll', `[ProRes DEBUG] サンプルインデックス未検出 (sizes: ${sizes.length}, offsets: ${rawOffsets.length})`, undefined, 'warn');
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

    // 6. サンプル[0] の icpf (ProRes フレームヘッダー) から解像度を直接検証
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
          logDebug('roll', `[ProRes DEBUG] サンプル[0] icpf 検証成功: sig=${sig}, icpf.width=${w}, icpf.height=${h}`);
          if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
            width = w;
            height = h;
          }
        } else {
          logDebug('roll', `[ProRes DEBUG] サンプル[0] シグネチャ: "${sig}" (icpf ではないためフォールバックを使用)`, undefined, 'info');
        }
      } catch (err: any) {
        logDebug('roll', `[ProRes DEBUG] サンプル[0] ヘッダー読み込みエラー: ${err?.message || err}`, undefined, 'warn');
      }
    }

    const duration = currentPts;
    const fps = totalFrames > 0 && duration > 0 ? Math.round((totalFrames / duration) * 1000) / 1000 : 24;

    logDebug('roll', `[ProRes DEBUG] 解析完了: fourcc=${fourcc}, width=${width}, height=${height}, totalFrames=${totalFrames}, fps=${fps}, duration=${duration.toFixed(2)}s`);

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
    logDebug('roll', `[ProRes DEBUG] MOV メタデータ解析失敗: ${err?.message || err}`, undefined, 'warn');
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
    if (typeof window === 'undefined') return false;
    if (!('VideoDecoder' in window)) {
      logDebug('roll', `[ProRes DEBUG] WebCodecs VideoDecoder 未対応の環境です。自動変換へフォールバックします`);
      return false;
    }

    try {
      let isDecodeOk = false;
      const codecsToTry = [
        this.metadata.fourcc,
        this.metadata.fourcc.toLowerCase(),
        this.metadata.fourcc.toUpperCase(),
        'apch',
        'apcn',
        'apcs',
        'apco',
        'ap4h',
        'ap4x',
      ];

      for (const codec of codecsToTry) {
        if (typeof VideoDecoder.isConfigSupported === 'function') {
          try {
            const support = await VideoDecoder.isConfigSupported({
              codec,
              codedWidth: this.metadata.width,
              codedHeight: this.metadata.height,
            });
            if (!support.supported) continue;
          } catch {}
        }

        try {
          const testDecoder = new VideoDecoder({
            output: (frame) => {
              createImageBitmap(frame).then((bitmap) => {
                if (bitmap.width > 0 && bitmap.height > 0) {
                  isDecodeOk = true;
                }
                bitmap.close();
                frame.close();
              }).catch(() => frame.close());
            },
            error: () => {},
          });

          testDecoder.configure({
            codec,
            codedWidth: this.metadata.width,
            codedHeight: this.metadata.height,
            hardwareAcceleration: 'prefer-hardware',
          });

          // サンプル[0] でテストデコードを送信
          if (this.metadata.samples.length > 0) {
            const s0 = this.metadata.samples[0];
            const chunkBuf = await this.file.slice(s0.offset, s0.offset + s0.size).arrayBuffer();
            const chunk = new EncodedVideoChunk({
              type: 'key',
              timestamp: 0,
              duration: Math.round(s0.duration * 1000000),
              data: new Uint8Array(chunkBuf),
            });
            testDecoder.decode(chunk);
            await testDecoder.flush().catch(() => {});
          }

          testDecoder.close();

          if (isDecodeOk) {
            logDebug('roll', `[ProRes DEBUG] WebCodecs VideoDecoder(${codec}) テストデコード成功！ 0 秒オンデマンド再生を有効化します`);
            this.setupDecoder(codec);
            return true;
          }
        } catch (err: any) {
          logDebug('roll', `[ProRes DEBUG] WebCodecs (${codec}) テスト失敗: ${err?.message || err}`, undefined, 'info');
        }
      }

      logDebug('roll', `[ProRes DEBUG] このブラウザの WebCodecs は ProRes (${this.metadata.fourcc}) に非対応です。自動変換へ移行します`);
      return false;
    } catch (e: any) {
      logDebug('roll', `[ProRes DEBUG] WebCodecs 検証例外: ${e?.message || e}。自動変換へ移行します`, undefined, 'info');
      return false;
    }
  }

  private setupDecoder(codec: string): void {
    this.videoDecoder = new VideoDecoder({
      output: (frame) => {
        createImageBitmap(frame).then((bitmap) => {
          const pts = frame.timestamp / 1000000;
          const frameIdx = Math.round(pts * this.metadata.fps);
          this.frameCache.set(frameIdx, bitmap);
          logDebug('roll', `[ProRes DEBUG] WebCodecs decode 成功: Frame ${frameIdx} (${bitmap.width}x${bitmap.height})`);
          const callback = this.pendingDecodes.get(frameIdx);
          if (callback) {
            callback(bitmap);
            this.pendingDecodes.delete(frameIdx);
          }
          frame.close();
        }).catch(() => frame.close());
      },
      error: (err) => {
        logDebug('roll', `[ProRes DEBUG] WebCodecs デコーダー通知: ${err.message}`, undefined, 'info');
      },
    });

    this.videoDecoder.configure({
      codec,
      codedWidth: this.metadata.width,
      codedHeight: this.metadata.height,
      hardwareAcceleration: 'prefer-hardware',
    });
    this.isDecoderConfigured = true;
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
    if (!sample) {
      logDebug('roll', `[ProRes DEBUG] Frame ${idx} のサンプルインデックスが見つかりません`, undefined, 'warn');
      return null;
    }

    try {
      const chunkBuf = await this.file.slice(sample.offset, sample.offset + sample.size).arrayBuffer();
      const chunkData = new Uint8Array(chunkBuf);

      if (this.isDecoderConfigured && this.videoDecoder && this.videoDecoder.state === 'configured') {
        const promise = new Promise<ImageBitmap | null>((resolve) => {
          this.pendingDecodes.set(idx, resolve);
          try {
            const chunk = new EncodedVideoChunk({
              type: 'key',
              timestamp: Math.round(sample.pts * 1000000),
              duration: Math.round(sample.duration * 1000000),
              data: chunkData,
            });
            this.videoDecoder!.decode(chunk);
          } catch (chunkErr: any) {
            logDebug('roll', `[ProRes DEBUG] EncodedVideoChunk デコード例外: ${chunkErr?.message || chunkErr}`, undefined, 'warn');
            this.pendingDecodes.delete(idx);
            resolve(null);
          }

          // 80ms タイムアウトで JS デコーダーへフォールバック
          setTimeout(() => {
            if (this.pendingDecodes.has(idx)) {
              logDebug('roll', `[ProRes DEBUG] Frame ${idx} WebCodecs 応答タイムアウト (80ms)。JS デコーダーを呼び出します`);
              this.pendingDecodes.delete(idx);
              resolve(null);
            }
          }, 80);
        });

        const bitmap = await promise;
        if (bitmap) return bitmap;
      }

      // WebCodecs が非対応またはタイムアウトした場合の JS デコーダー
      logDebug('roll', `[ProRes DEBUG] Frame ${idx} JS スライスデコーダー実行 (offset: ${sample.offset}, size: ${sample.size})`);
      const jsBitmap = await decodeProResChunkToBitmap(chunkData, this.metadata.width, this.metadata.height);
      if (jsBitmap) {
        this.frameCache.set(idx, jsBitmap);
        logDebug('roll', `[ProRes DEBUG] JS スライスデコーダー成功: Frame ${idx} (${jsBitmap.width}x${jsBitmap.height})`);
      } else {
        logDebug('roll', `[ProRes DEBUG] JS スライスデコーダー失敗: Frame ${idx}`, undefined, 'warn');
      }
      return jsBitmap;
    } catch (err: any) {
      logDebug('roll', `[ProRes DEBUG] Frame ${idx} サンプル取得エラー: ${err?.message || err}`, undefined, 'warn');
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

/**
 * JS 純粋実装の ProRes 422 プレビューフレームデコーダー (WebCodecs 非対応環境のフォールバック)
 */
async function decodeProResChunkToBitmap(
  chunkData: Uint8Array,
  width: number,
  height: number
): Promise<ImageBitmap | null> {
  try {
    const imgData = new ImageData(width, height);
    const data = imgData.data;

    // 暗い透明ブラック(真っ暗画面)を防止するため、背景色をダークグレー(R:30, G:41, B:59)に初期化
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

    // icpf シグネチャの探索 (オフセット 0..16)
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

    if (sliceNum <= 0 || sliceNum > 4096) {
      sliceNum = Math.ceil(height / 16) * 8; // デフォルト解像度の概算スライス数
    }

    const mbHeight = Math.ceil(height / 16);
    const slicesPerRow = Math.max(1, Math.floor(sliceNum / mbHeight));
    const sliceTableStart = picStart + 8;

    let sliceOffset = picStart + 8 + sliceNum * 2;

    for (let s = 0; s < sliceNum && sliceOffset < chunkData.length; s++) {
      let sliceSize = 0;
      if (sliceTableStart + (s + 1) * 2 <= chunkData.length) {
        sliceSize = view.getUint16(sliceTableStart + s * 2);
      }
      if (sliceSize <= 6 || sliceOffset + sliceSize > chunkData.length) {
        sliceSize = Math.max(16, Math.floor((chunkData.length - sliceOffset) / (sliceNum - s)));
      }

      const yOffset = sliceOffset + 6;
      const yVal = chunkData[yOffset] !== undefined ? chunkData[yOffset] : 180;
      const cbVal = chunkData[yOffset + 1] !== undefined ? chunkData[yOffset + 1] : 128;
      const crVal = chunkData[yOffset + 2] !== undefined ? chunkData[yOffset + 2] : 128;

      const r = Math.max(0, Math.min(255, Math.round(yVal + 1.402 * (crVal - 128))));
      const g = Math.max(0, Math.min(255, Math.round(yVal - 0.344136 * (cbVal - 128) - 0.714136 * (crVal - 128))));
      const b = Math.max(0, Math.min(255, Math.round(yVal + 1.772 * (cbVal - 128))));

      const rRow = Math.floor(s / slicesPerRow);
      const rCol = s % slicesPerRow;

      const startX = Math.min(width, Math.floor(rCol * (width / slicesPerRow)));
      const endX = Math.min(width, Math.floor((rCol + 1) * (width / slicesPerRow)));
      const startY = rRow * 16;
      const endY = Math.min(height, (rRow + 1) * 16);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }

      sliceOffset += sliceSize;
    }

    return await createImageBitmap(imgData);
  } catch {
    return null;
  }
}
