/**
 * Apple ProRes 422 / 4444 の 1 フレームを復号する (SMPTE RDD 36 準拠)。
 *
 * DOM に依存しない純粋な計算だけを置く。Worker からも Node のテストからも呼べるようにするため。
 * 手順は FFmpeg の proresdec と同じ:
 *   フレームヘッダー → ピクチャヘッダー → スライス索引 → スライスごとに
 *   DC (差分 + 適応符号) / AC (run-level 適応符号) → 逆量子化 → 8x8 逆 DCT
 *
 * ⚠️ 係数の並べ方 (スキャン順) は JPEG のジグザグではない。プログレッシブとインターレースで別の表を使う。
 * ⚠️ アルファ (4444 の 4 番目の成分) は読み飛ばす。ロール確認では不要。
 */

export interface ProResFrameHeader {
  width: number;
  height: number;
  /** 0 = プログレッシブ, 1 = トップフィールド先行, 2 = ボトムフィールド先行 */
  frameType: number;
  /** 2 = 4:2:2, 3 = 4:4:4 */
  chromaFormat: number;
  /** 1 = BT.709, 6 = BT.601 など (ISO/IEC 23001-8 の matrix_coefficients) */
  matrix: number;
}

/** 復号結果。10 bit の値をそのまま持つ (Y: 64..940, Cb/Cr: 中心 512) */
export interface ProResPlanes {
  header: ProResFrameHeader;
  /** マクロブロック単位に切り上げた幅と高さ (16 の倍数) */
  lumaWidth: number;
  lumaHeight: number;
  chromaWidth: number;
  y: Int16Array;
  cb: Int16Array;
  cr: Int16Array;
}

export const PROGRESSIVE_SCAN = new Uint8Array([
  0, 1, 8, 9, 2, 3, 10, 11,
  16, 17, 24, 25, 18, 19, 26, 27,
  4, 5, 12, 20, 13, 6, 7, 14,
  21, 28, 29, 22, 15, 23, 30, 31,
  32, 33, 40, 48, 41, 34, 35, 42,
  49, 56, 57, 50, 43, 36, 37, 44,
  51, 58, 59, 52, 45, 38, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
]);

export const INTERLACED_SCAN = new Uint8Array([
  0, 8, 1, 9, 16, 24, 17, 25,
  2, 10, 3, 11, 18, 26, 19, 27,
  32, 40, 33, 34, 41, 48, 56, 49,
  42, 35, 43, 50, 57, 58, 51, 59,
  4, 12, 5, 6, 13, 20, 28, 21,
  14, 7, 15, 22, 29, 36, 44, 37,
  30, 23, 31, 38, 45, 52, 60, 53,
  46, 39, 47, 54, 61, 62, 55, 63,
]);

const FIRST_DC_CB = 0xb8;
const DC_CODEBOOK = [0x04, 0x28, 0x28, 0x4d, 0x4d, 0x70, 0x70];
const RUN_TO_CB = [0x06, 0x06, 0x05, 0x05, 0x04, 0x29, 0x29, 0x29, 0x29, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x4c];
const LEV_TO_CB = [0x04, 0x0a, 0x05, 0x06, 0x04, 0x28, 0x28, 0x28, 0x28, 0x4c];

/** 符号の読み取り位置。ビット単位 */
let bitPos = 0;
let bitData: Uint8Array = new Uint8Array(0);

/** 現在位置から 32 bit 先読みする (範囲外は 0 として読む) */
function peek32(): number {
  const d = bitData;
  const byte = bitPos >>> 3;
  const sh = bitPos & 7;
  const v = ((d[byte] << 24) | (d[byte + 1] << 16) | (d[byte + 2] << 8) | d[byte + 3]) >>> 0;
  if (sh === 0) return v;
  return ((v << sh) | ((d[byte + 4] | 0) >>> (8 - sh))) >>> 0;
}

/**
 * Rice / 指数ゴロムの混合符号を 1 つ読む。
 * 符号表の 1 バイト = rice 次数 (上 3 bit) / 指数ゴロム次数 (中 3 bit) / 切替閾値 (下 2 bit)。
 * 壊れたデータなら -1 を返す。
 */
function readCodeword(codebook: number): number {
  const buf = peek32();
  const switchBits = codebook & 3;
  const riceOrder = codebook >> 5;
  const expOrder = (codebook >> 2) & 7;
  const q = Math.clz32(buf);

  if (q > switchBits) {
    const bits = expOrder - switchBits + (q << 1);
    if (bits > 31) return -1;
    const val = (buf >>> (32 - bits)) - (1 << expOrder) + ((switchBits + 1) << riceOrder);
    bitPos += bits;
    return val;
  }
  if (riceOrder) {
    bitPos += q + 1;
    const val = (q << riceOrder) + (peek32() >>> (32 - riceOrder));
    bitPos += riceOrder;
    return val;
  }
  bitPos += q + 1;
  return q;
}

/** スライス内の全ブロックの DC を読む (先頭は絶対値、以降は差分) */
function decodeDc(out: Int32Array, blockCount: number): boolean {
  let code = readCodeword(FIRST_DC_CB);
  if (code < 0) return false;
  let prevDc = (code >> 1) ^ -(code & 1);
  out[0] = prevDc;
  code = 5;
  let sign = 0;
  for (let i = 1; i < blockCount; i++) {
    code = readCodeword(DC_CODEBOOK[Math.min(code, 6)]);
    if (code < 0) return false;
    if (code) sign ^= -(code & 1);
    else sign = 0;
    prevDc += (((code + 1) >> 1) ^ sign) - sign;
    out[i << 6] = prevDc;
  }
  return true;
}

/**
 * AC を読む。係数はスライス内の全ブロックを横断して周波数順に交互に並ぶ。
 * ⚠️ 終端は「残りビットが無い、または残りが全部 0」で判定する (件数は書かれていない)。
 */
function decodeAc(out: Int32Array, blockCount: number, endBit: number, scan: Uint8Array): boolean {
  const log2Blocks = 31 - Math.clz32(blockCount);
  const maxCoeffs = 64 << log2Blocks;
  const blockMask = (1 << log2Blocks) - 1;
  let run = 4;
  let level = 2;
  let pos = blockMask;

  for (;;) {
    const bitsLeft = endBit - bitPos;
    if (bitsLeft <= 0 || (bitsLeft < 32 && peek32() >>> (32 - bitsLeft) === 0)) break;

    run = readCodeword(RUN_TO_CB[Math.min(run, 15)]);
    if (run < 0) return false;
    pos += run + 1;
    if (pos >= maxCoeffs) return false;

    level = readCodeword(LEV_TO_CB[Math.min(level, 9)]);
    if (level < 0) return false;
    level += 1;

    const neg = peek32() >>> 31;
    bitPos += 1;
    out[((pos & blockMask) << 6) + scan[pos >> log2Blocks]] = neg ? -level : level;
  }
  return true;
}

// ---- 逆 DCT (AAN 浮動小数点。libjpeg の jidctflt と同じ流れ) ----

const AAN = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.541196100, 0.275899379];
/** 係数 (JPEG 流の正規直交 DCT 係数) に掛ける 2 次元の AAN 係数 */
export const AAN_SCALE = new Float64Array(64);
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) AAN_SCALE[r * 8 + c] = AAN[r] * AAN[c] / 8;

const ws = new Float64Array(64);

/**
 * 8x8 逆 DCT。input は AAN_SCALE を掛け済みの係数 (ラスター順)、out は画素値 (正規直交 IDCT の結果)。
 */
export function idctAan(input: Float64Array, out: Float64Array, outOffset: number): void {
  for (let c = 0; c < 8; c++) {
    const i1 = input[8 + c], i2 = input[16 + c], i3 = input[24 + c], i4 = input[32 + c];
    const i5 = input[40 + c], i6 = input[48 + c], i7 = input[56 + c];
    if ((i1 === 0) && (i2 === 0) && (i3 === 0) && (i4 === 0) && (i5 === 0) && (i6 === 0) && (i7 === 0)) {
      const dc = input[c];
      for (let r = 0; r < 8; r++) ws[r * 8 + c] = dc;
      continue;
    }
    const i0 = input[c];
    const t10 = i0 + i4;
    const t11 = i0 - i4;
    const t13 = i2 + i6;
    const t12 = (i2 - i6) * 1.414213562 - t13;
    const e0 = t10 + t13, e3 = t10 - t13, e1 = t11 + t12, e2 = t11 - t12;

    const z13 = i5 + i3, z10 = i5 - i3, z11 = i1 + i7, z12 = i1 - i7;
    const o7 = z11 + z13;
    const o11 = (z11 - z13) * 1.414213562;
    const z5 = (z10 + z12) * 1.847759065;
    const o10 = z5 - z12 * 1.082392200;
    const o12 = z5 - z10 * 2.613125930;
    const o6 = o12 - o7;
    const o5 = o11 - o6;
    const o4 = o10 - o5;

    ws[c] = e0 + o7; ws[56 + c] = e0 - o7;
    ws[8 + c] = e1 + o6; ws[48 + c] = e1 - o6;
    ws[16 + c] = e2 + o5; ws[40 + c] = e2 - o5;
    ws[24 + c] = e3 + o4; ws[32 + c] = e3 - o4;
  }

  for (let r = 0; r < 64; r += 8) {
    const i0 = ws[r], i1 = ws[r + 1], i2 = ws[r + 2], i3 = ws[r + 3];
    const i4 = ws[r + 4], i5 = ws[r + 5], i6 = ws[r + 6], i7 = ws[r + 7];
    const t10 = i0 + i4;
    const t11 = i0 - i4;
    const t13 = i2 + i6;
    const t12 = (i2 - i6) * 1.414213562 - t13;
    const e0 = t10 + t13, e3 = t10 - t13, e1 = t11 + t12, e2 = t11 - t12;

    const z13 = i5 + i3, z10 = i5 - i3, z11 = i1 + i7, z12 = i1 - i7;
    const o7 = z11 + z13;
    const o11 = (z11 - z13) * 1.414213562;
    const z5 = (z10 + z12) * 1.847759065;
    const o10 = z5 - z12 * 1.082392200;
    const o12 = z5 - z10 * 2.613125930;
    const o6 = o12 - o7;
    const o5 = o11 - o6;
    const o4 = o10 - o5;

    const o = outOffset + r;
    out[o] = e0 + o7; out[o + 7] = e0 - o7;
    out[o + 1] = e1 + o6; out[o + 6] = e1 - o6;
    out[o + 2] = e2 + o5; out[o + 5] = e2 - o5;
    out[o + 3] = e3 + o4; out[o + 4] = e3 - o4;
  }
}

const blockIn = new Float64Array(64);
const blockOut = new Float64Array(64);

/**
 * 1 ブロックを逆量子化 → 逆 DCT し、10 bit 画素として plane に書く。
 * ProRes の係数は正規直交 DCT の 4 倍なので、IDCT 後に 1/4 して 512 を足す。
 * (FFmpeg: 行パス後に 8192 を足し、列パスで 1/16 → 画素 512)
 */
function putBlock(
  coeffs: Int32Array, base: number, qmat: Int32Array,
  plane: Int16Array, stride: number, rowStep: number, x0: number, y0: number,
): void {
  let acAny = false;
  for (let i = 1; i < 64; i++) {
    if (coeffs[base + i] !== 0) { acAny = true; break; }
  }
  if (!acAny) {
    // DC だけのブロックは全画素が同じ値
    let v = (coeffs[base] * qmat[0] * 0.03125 + 512.5) | 0;
    v = v < 4 ? 4 : v > 1019 ? 1019 : v;
    for (let y = 0; y < 8; y++) {
      const row = (y0 + y * rowStep) * stride + x0;
      for (let x = 0; x < 8; x++) plane[row + x] = v;
    }
    return;
  }
  for (let i = 0; i < 64; i++) {
    const c = coeffs[base + i];
    blockIn[i] = c === 0 ? 0 : c * qmat[i] * AAN_SCALE[i];
  }
  idctAan(blockIn, blockOut, 0);
  for (let y = 0; y < 8; y++) {
    const row = (y0 + y * rowStep) * stride + x0;
    for (let x = 0; x < 8; x++) {
      let v = (blockOut[y * 8 + x] * 0.25 + 512.5) | 0;
      v = v < 4 ? 4 : v > 1019 ? 1019 : v;
      plane[row + x] = v;
    }
  }
}

export function readFrameHeader(frame: Uint8Array): { header: ProResFrameHeader; hdrStart: number; hdrSize: number; flags: number } | null {
  // フレーム = [frame_size(4)] ['icpf'(4)] [フレームヘッダー] [ピクチャ 1 or 2]
  if (frame.length < 28) return null;
  if (frame[4] !== 0x69 || frame[5] !== 0x63 || frame[6] !== 0x70 || frame[7] !== 0x66) return null;
  const h = 8;
  const hdrSize = (frame[h] << 8) | frame[h + 1];
  const version = (frame[h + 2] << 8) | frame[h + 3];
  // ⚠️ ヘッダー全体 (量子化マトリクス込みで 148 バイトほど) が揃っているかはここでは見ない。
  // 索引作りでは先頭の数十バイトだけ読んで寸法を確かめるため。全体の確認は decodeProResFrame で行う
  if (version > 1 || hdrSize < 20) return null;
  const width = (frame[h + 8] << 8) | frame[h + 9];
  const height = (frame[h + 10] << 8) | frame[h + 11];
  if (!width || !height) return null;
  return {
    header: {
      width,
      height,
      frameType: (frame[h + 12] >> 2) & 3,
      chromaFormat: frame[h + 12] >> 6,
      matrix: frame[h + 16],
    },
    hdrStart: h,
    hdrSize,
    flags: frame[h + 19],
  };
}

export class ProResDecodeError extends Error {}

/**
 * 1 フレームを復号して 10 bit の Y / Cb / Cr プレーンを返す。
 * reuse を渡すと、同じ寸法ならプレーンを使い回す (毎コマの確保を避ける)。
 */
export function decodeProResFrame(frame: Uint8Array, reuse?: ProResPlanes | null): ProResPlanes {
  const fh = readFrameHeader(frame);
  if (!fh) throw new ProResDecodeError('icpf フレームヘッダーを読めません');
  const { header, hdrStart, hdrSize, flags } = fh;
  if (hdrStart + hdrSize > frame.length) throw new ProResDecodeError('フレームヘッダーが途中で切れています');
  const { width, height, frameType, chromaFormat } = header;
  if (chromaFormat !== 2 && chromaFormat !== 3) throw new ProResDecodeError(`未対応のクロマ形式: ${chromaFormat}`);

  // 量子化マトリクス (ラスター順)。無ければ全部 4
  const qmatLuma = new Int32Array(64).fill(4);
  let p = hdrStart + 20;
  if (flags & 2) {
    for (let i = 0; i < 64; i++) qmatLuma[i] = frame[p + i];
    p += 64;
  }
  const qmatChroma = new Int32Array(qmatLuma);
  if (flags & 1) {
    for (let i = 0; i < 64; i++) qmatChroma[i] = frame[p + i];
  }

  const mbWidth = (width + 15) >> 4;
  const lumaWidth = mbWidth << 4;
  const fieldMbHeight = frameType ? (height + 31) >> 5 : (height + 15) >> 4;
  const lumaHeight = frameType ? fieldMbHeight << 5 : fieldMbHeight << 4;
  const log2ChromaBlocks = chromaFormat === 2 ? 1 : 2;
  const chromaWidth = chromaFormat === 2 ? lumaWidth >> 1 : lumaWidth;

  let planes = reuse;
  if (!planes || planes.lumaWidth !== lumaWidth || planes.lumaHeight !== lumaHeight || planes.chromaWidth !== chromaWidth) {
    planes = {
      header,
      lumaWidth,
      lumaHeight,
      chromaWidth,
      y: new Int16Array(lumaWidth * lumaHeight),
      cb: new Int16Array(chromaWidth * lumaHeight),
      cr: new Int16Array(chromaWidth * lumaHeight),
    };
  }
  planes.header = header;

  const scan = frameType ? INTERLACED_SCAN : PROGRESSIVE_SCAN;
  const rowStep = frameType ? 2 : 1;
  const qLuma = new Int32Array(64);
  const qChroma = new Int32Array(64);
  const coeffs = new Int32Array(64 * 32);

  let picPos = hdrStart + hdrSize;
  const fieldCount = frameType ? 2 : 1;
  for (let field = 0; field < fieldCount; field++) {
    if (picPos + 8 > frame.length) throw new ProResDecodeError('ピクチャヘッダーが途中で切れています');
    const picHdrSize = frame[picPos] >> 3;
    const picDataSize = ((frame[picPos + 1] << 24) | (frame[picPos + 2] << 16) | (frame[picPos + 3] << 8) | frame[picPos + 4]) >>> 0;
    const log2SliceMbWidth = frame[picPos + 7] >> 4;
    if (log2SliceMbWidth > 3 || (frame[picPos + 7] & 15)) throw new ProResDecodeError('未対応のスライス寸法');

    // 2 枚目のフィールドは 1 行下にずらす (トップ先行なら 1 枚目が上の行)
    const topFieldFirst = frameType === 1;
    const fieldRowOffset = frameType && ((field === 0) !== topFieldFirst) ? 1 : 0;

    // ⚠️ 書かれているスライス数は信用しない (QuickTime も無視する)。寸法から計算する
    const sliceMb = 1 << log2SliceMbWidth;
    let sliceCount = 0;
    for (let x = 0; x < mbWidth;) {
      let n = sliceMb;
      while (mbWidth - x < n) n >>= 1;
      sliceCount++;
      x += n;
    }
    sliceCount *= fieldMbHeight;

    const indexPos = picPos + picHdrSize;
    let dataPos = indexPos + sliceCount * 2;
    let s = 0;
    for (let mbY = 0; mbY < fieldMbHeight; mbY++) {
      for (let mbX = 0; mbX < mbWidth;) {
        let mbCount = sliceMb;
        while (mbWidth - mbX < mbCount) mbCount >>= 1;

        const sliceSize = (frame[indexPos + s * 2] << 8) | frame[indexPos + s * 2 + 1];
        const slice = dataPos;
        dataPos += sliceSize;
        s++;
        if (dataPos > frame.length) throw new ProResDecodeError('スライスがフレームの外にはみ出しています');

        const sHdr = frame[slice] >> 3;
        let qscale = frame[slice + 1];
        qscale = qscale < 1 ? 1 : qscale > 224 ? 224 : qscale;
        if (qscale > 128) qscale = (qscale - 96) << 2;
        const ySize = (frame[slice + 2] << 8) | frame[slice + 3];
        const uSize = (frame[slice + 4] << 8) | frame[slice + 5];
        const vSize = sHdr > 7 ? (frame[slice + 6] << 8) | frame[slice + 7] : sliceSize - ySize - uSize - sHdr;
        for (let i = 0; i < 64; i++) {
          qLuma[i] = qmatLuma[i] * qscale;
          qChroma[i] = qmatChroma[i] * qscale;
        }

        const payload = slice + sHdr;
        const lumaY = ((mbY << 4) << (frameType ? 1 : 0)) + fieldRowOffset;

        // 輝度: 1 マクロブロックに 8x8 が 4 つ (左上, 右上, 左下, 右下)
        let blocks = mbCount << 2;
        coeffs.fill(0, 0, blocks << 6);
        readComponent(frame, payload, ySize, coeffs, blocks, scan);
        for (let m = 0; m < mbCount; m++) {
          const x = (mbX + m) << 4;
          const b = m << 8;
          putBlock(coeffs, b, qLuma, planes.y, lumaWidth, rowStep, x, lumaY);
          putBlock(coeffs, b + 64, qLuma, planes.y, lumaWidth, rowStep, x + 8, lumaY);
          putBlock(coeffs, b + 128, qLuma, planes.y, lumaWidth, rowStep, x, lumaY + 8 * rowStep);
          putBlock(coeffs, b + 192, qLuma, planes.y, lumaWidth, rowStep, x + 8, lumaY + 8 * rowStep);
        }

        // 色差: 4:2:2 は縦に 2 つ、4:4:4 は輝度と同じ 4 つ
        blocks = mbCount << log2ChromaBlocks;
        for (let comp = 0; comp < 2; comp++) {
          const plane = comp === 0 ? planes.cb : planes.cr;
          const start = comp === 0 ? payload + ySize : payload + ySize + uSize;
          const size = comp === 0 ? uSize : vSize;
          coeffs.fill(0, 0, blocks << 6);
          readComponent(frame, start, size, coeffs, blocks, scan);
          for (let m = 0; m < mbCount; m++) {
            if (log2ChromaBlocks === 1) {
              const x = (mbX + m) << 3;
              const b = m << 7;
              putBlock(coeffs, b, qChroma, plane, chromaWidth, rowStep, x, lumaY);
              putBlock(coeffs, b + 64, qChroma, plane, chromaWidth, rowStep, x, lumaY + 8 * rowStep);
            } else {
              const x = (mbX + m) << 4;
              const b = m << 8;
              putBlock(coeffs, b, qChroma, plane, chromaWidth, rowStep, x, lumaY);
              putBlock(coeffs, b + 64, qChroma, plane, chromaWidth, rowStep, x + 8, lumaY);
              putBlock(coeffs, b + 128, qChroma, plane, chromaWidth, rowStep, x, lumaY + 8 * rowStep);
              putBlock(coeffs, b + 192, qChroma, plane, chromaWidth, rowStep, x + 8, lumaY + 8 * rowStep);
            }
          }
        }

        mbX += mbCount;
      }
    }
    picPos += picDataSize;
  }

  return planes;
}

/** 1 成分分のビット列から DC と AC を読む。壊れていたらそのスライスは DC までで諦める */
function readComponent(frame: Uint8Array, start: number, size: number, coeffs: Int32Array, blocks: number, scan: Uint8Array): void {
  if (size <= 0) return;
  bitData = frame;
  bitPos = start * 8;
  const endBit = (start + size) * 8;
  if (!decodeDc(coeffs, blocks)) return;
  decodeAc(coeffs, blocks, endBit, scan);
}

/**
 * 10 bit YCbCr (リミテッドレンジ) → 8 bit RGBA。表示サイズ (width x height) だけ書く。
 */
export function planesToRgba(planes: ProResPlanes, out: Uint8ClampedArray): void {
  const { width, height, matrix } = planes.header;
  const bt601 = matrix === 5 || matrix === 6 || (matrix !== 1 && height < 720);
  const kr = bt601 ? 1.596027 : 1.792741;
  const kgb = bt601 ? 0.391762 : 0.213249;
  const kgr = bt601 ? 0.812968 : 0.532909;
  const kb = bt601 ? 2.017232 : 2.112402;
  const ky = 1.164384;
  const chromaShift = planes.chromaWidth === planes.lumaWidth ? 0 : 1;
  const { y: Y, cb: Cb, cr: Cr, lumaWidth, chromaWidth } = planes;

  let o = 0;
  for (let row = 0; row < height; row++) {
    const yRow = row * lumaWidth;
    const cRow = row * chromaWidth;
    for (let col = 0; col < width; col++) {
      const yy = ky * (Y[yRow + col] - 64) / 4;
      const ci = cRow + (col >> chromaShift);
      const cb = (Cb[ci] - 512) / 4;
      const cr = (Cr[ci] - 512) / 4;
      out[o] = yy + kr * cr;
      out[o + 1] = yy - kgb * cb - kgr * cr;
      out[o + 2] = yy + kb * cb;
      out[o + 3] = 255;
      o += 4;
    }
  }
}
