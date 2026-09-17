import { describe, it, expect } from 'vitest';
import { AAN_SCALE, decodeProResFrame, idctAan, INTERLACED_SCAN, planesToRgba, PROGRESSIVE_SCAN, readFrameHeader } from './proresBitstream';

/** 定義どおりの正規直交 8x8 逆 DCT (遅いが確実) */
function referenceIdct(coeffs: Float64Array): Float64Array {
  const out = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          const cu = u === 0 ? Math.SQRT1_2 : 1;
          const cv = v === 0 ? Math.SQRT1_2 : 1;
          sum += cu * cv * coeffs[v * 8 + u]
            * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
            * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }
      out[y * 8 + x] = sum / 4;
    }
  }
  return out;
}

describe('ProRes 逆 DCT', () => {
  it('AAN 実装が定義どおりの逆 DCT と一致する', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let trial = 0; trial < 50; trial++) {
      const coeffs = new Float64Array(64);
      for (let i = 0; i < 64; i++) coeffs[i] = trial % 5 === 0 && i > 0 ? 0 : Math.round(rand() * 2000);
      const scaled = new Float64Array(64);
      for (let i = 0; i < 64; i++) scaled[i] = coeffs[i] * AAN_SCALE[i];
      const got = new Float64Array(64);
      idctAan(scaled, got, 0);
      const want = referenceIdct(coeffs);
      for (let i = 0; i < 64; i++) expect(got[i]).toBeCloseTo(want[i], 3);
    }
  });

  it('スキャン表は 0..63 をちょうど 1 回ずつ含む', () => {
    for (const scan of [PROGRESSIVE_SCAN, INTERLACED_SCAN]) {
      expect([...scan].sort((a, b) => a - b)).toEqual([...Array(64).keys()]);
    }
  });
});

describe('ProRes フレームヘッダー', () => {
  it('icpf ヘッダーから寸法・走査方式・クロマ形式を読む', () => {
    const frame = new Uint8Array(200);
    const v = new DataView(frame.buffer);
    v.setUint32(0, 200);
    frame.set([0x69, 0x63, 0x70, 0x66], 4);
    v.setUint16(8, 148); // hdr_size
    v.setUint16(10, 0); // version
    v.setUint16(16, 1920);
    v.setUint16(18, 1080);
    frame[20] = (2 << 6) | (1 << 2); // 4:2:2, トップフィールド先行
    frame[24] = 1; // BT.709

    const fh = readFrameHeader(frame);
    expect(fh?.header).toEqual({ width: 1920, height: 1080, frameType: 1, chromaFormat: 2, matrix: 1 });
  });

  it('icpf で始まらないデータは null', () => {
    expect(readFrameHeader(new Uint8Array(64))).toBeNull();
  });
});

/** テスト用の最小ビット書き込み */
class BitWriter {
  bytes: number[] = [];
  private cur = 0;
  private n = 0;
  put(value: number, bits: number) {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >>> i) & 1);
      if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
    }
  }
  /** readCodeword の逆 */
  codeword(val: number, codebook: number) {
    const switchBits = codebook & 3;
    const rice = codebook >> 5;
    const exp = (codebook >> 2) & 7;
    if (val < (switchBits + 1) << rice) {
      const q = val >> rice;
      this.put(0, q);
      this.put(1, 1);
      if (rice) this.put(val & ((1 << rice) - 1), rice);
    } else {
      const v = val - ((switchBits + 1) << rice) + (1 << exp);
      const len = 32 - Math.clz32(v);
      this.put(0, len - exp + switchBits);
      this.put(v, len);
    }
  }
  finish(): number[] {
    if (this.n) this.put(0, 8 - this.n);
    return this.bytes;
  }
}

/** 16x16 の一色だけのフレームを組み立てる (4:2:2、1 スライス、量子化マトリクス無し = 全部 4) */
function flatFrame(y10: number, cb10: number, cr10: number): Uint8Array {
  const component = (value10: number, blocks: number) => {
    const w = new BitWriter();
    const dc = (value10 - 512) * 8; // 画素 = DC * 4 (qmat) * 1 (qscale) / 32 + 512
    w.codeword(dc >= 0 ? dc * 2 : -dc * 2 - 1, 0xb8);
    let code = 5;
    const books = [0x04, 0x28, 0x28, 0x4d, 0x4d, 0x70, 0x70];
    for (let i = 1; i < blocks; i++) { w.codeword(0, books[Math.min(code, 6)]); code = 0; }
    return w.finish();
  };
  const yBits = component(y10, 4);
  const uBits = component(cb10, 2);
  const vBits = component(cr10, 2);
  const slice = [6 << 3, 1, yBits.length >> 8, yBits.length & 255, uBits.length >> 8, uBits.length & 255, ...yBits, ...uBits, ...vBits];
  const picture = [8 << 3, 0, 0, 0, 0, 0, 1, 3 << 4, slice.length >> 8, slice.length & 255, ...slice];
  const picSize = picture.length;
  picture[1] = (picSize >>> 24) & 255; picture[2] = (picSize >>> 16) & 255; picture[3] = (picSize >>> 8) & 255; picture[4] = picSize & 255;

  const header = new Array(20).fill(0);
  header[1] = 20; // hdr_size
  header[9] = 16; header[11] = 16; // 16x16
  header[12] = 2 << 6; // 4:2:2 プログレッシブ
  header[16] = 1; // BT.709
  const total = 8 + header.length + picture.length;
  return new Uint8Array([total >>> 24, (total >>> 16) & 255, (total >>> 8) & 255, total & 255, 0x69, 0x63, 0x70, 0x66, ...header, ...picture]);
}

describe('ProRes 1 フレームの復号', () => {
  it('一色のフレームを 10 bit の値どおりに戻し、RGB へ変換する', () => {
    const planes = decodeProResFrame(flatFrame(700, 512, 512));
    expect(planes.header).toMatchObject({ width: 16, height: 16, chromaFormat: 2 });
    expect([...new Set(planes.y)]).toEqual([700]);
    expect([...new Set(planes.cb)]).toEqual([512]);
    expect([...new Set(planes.cr)]).toEqual([512]);

    const rgba = new Uint8ClampedArray(16 * 16 * 4);
    planesToRgba(planes, rgba);
    // (700 - 64) / 4 * 1.164 ≒ 185 の灰色
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([185, 185, 185, 255]);
  });

  it('色差も反映される (Cr を上げると赤くなる)', () => {
    const planes = decodeProResFrame(flatFrame(500, 512, 800));
    const rgba = new Uint8ClampedArray(16 * 16 * 4);
    planesToRgba(planes, rgba);
    expect(rgba[0]).toBeGreaterThan(rgba[1] + 100);
    expect(rgba[0]).toBeGreaterThan(rgba[2] + 100);
  });

  it('壊れたデータは例外にする', () => {
    const frame = flatFrame(700, 512, 512);
    expect(() => decodeProResFrame(frame.subarray(0, 40))).toThrow();
  });
});
