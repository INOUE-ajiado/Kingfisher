import { describe, it, expect } from 'vitest';
import { applyJpegDensity, readJpegDensity } from './jpegDensity';

/**
 * スキャン原稿は 300/600dpi で取り込まれ、後工程がその値を見る。
 * 書き出し直すたびに 72dpi へ落ちてしまわないようにする。
 */

/** JFIF (APP0) を持つ最小の JPEG もどきを作る */
function jpegWith(units: number, x: number, y: number, extraApp = false): Uint8Array {
  const app0 = [
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x02, // version
    units,
    (x >> 8) & 0xff, x & 0xff,
    (y >> 8) & 0xff, y & 0xff,
    0x00, 0x00, // サムネイルなし
  ];
  // ⚠️ APP0 の前に別のセグメントが来ることがある。辿れることを確かめる
  const before = extraApp ? [0xff, 0xe1, 0x00, 0x04, 0x00, 0x00] : [];
  return new Uint8Array([0xff, 0xd8, ...before, ...app0, 0xff, 0xda, 0x00, 0x02]);
}

describe('JPEG の解像度', () => {
  it('JFIF から dpi を読む', () => {
    expect(readJpegDensity(jpegWith(1, 600, 600))).toEqual({ units: 1, x: 600, y: 600 });
  });

  it('前に別のセグメントがあっても辿れる', () => {
    expect(readJpegDensity(jpegWith(1, 300, 300, true))).toEqual({ units: 1, x: 300, y: 300 });
  });

  it('JPEG でなければ null', () => {
    expect(readJpegDensity(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('書き出したものへ元の dpi を書き戻す', () => {
    const written = applyJpegDensity(jpegWith(1, 1, 1), { units: 1, x: 600, y: 600 });

    expect(readJpegDensity(written)).toEqual({ units: 1, x: 600, y: 600 });
  });

  it('元に dpi が無ければ触らない (壊れた JPEG を作らない)', () => {
    const out = jpegWith(1, 1, 1);
    expect(Array.from(applyJpegDensity(out, null))).toEqual(Array.from(out));
    expect(Array.from(applyJpegDensity(out, { units: 0, x: 1, y: 1 }))).toEqual(Array.from(out));
  });

  it('画素の側は 1 バイトも変えない', () => {
    const src = jpegWith(1, 72, 72);
    const out = applyJpegDensity(src, { units: 1, x: 600, y: 600 });

    // JFIF の密度 5 バイト以外は同じ
    const changed = Array.from(out).map((v, i) => (v === src[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toEqual([14, 15, 16, 17]); // x と y の 2 バイトずつ (units は 1 のまま)
  });
});
