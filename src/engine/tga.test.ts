import { describe, it, expect } from 'vitest';
import { decodeTGA, encodeTGA, TGAImage } from './tga';

/**
 * 「RGB(255,255,255) は完全透明、(254,254,254) は不透明な白」という
 * アニメ業界 (PaintMan) の規約を、読み書きの往復で守れているかを固定する。
 *
 * ⚠️ 消しゴムは alpha を 0 にするだけで RGB を残す (drawCircle)。
 * encodeTGA が alpha 0 を純白へ戻さないと、消した部分が元の色のまま復活する。
 */

function makeImage(pixels: number[][]): TGAImage {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => data.set(p, i * 4));
  return { width: pixels.length, height: 1, pixelDepth: 32, data };
}

/** 保存されたバイト列から 1 画素目の BGRA を読む */
function encodedPixel(buffer: ArrayBuffer, index = 0): number[] {
  const bytes = new Uint8Array(buffer);
  const at = 18 + index * 4;
  return [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
}

describe('encodeTGA — 透明画素の書き戻し', () => {
  it('alpha 0 の画素は純白として書き出す', () => {
    // 消しゴムで消した画素: 元の色が残ったまま alpha だけ 0
    const image = makeImage([[200, 30, 40, 0]]);

    const [b, g, r] = encodedPixel(encodeTGA(image));

    expect([r, g, b]).toEqual([255, 255, 255]);
  });

  it('消した画素は読み直しても透明のまま (元の色が復活しない)', () => {
    const image = makeImage([[200, 30, 40, 0]]);

    const restored = decodeTGA(encodeTGA(image));

    expect(restored.data[3]).toBe(0);
    expect(Array.from(restored.data.slice(0, 3))).toEqual([255, 255, 255]);
  });

  it('不透明な画素はそのまま往復する', () => {
    const image = makeImage([[12, 34, 56, 255]]);

    const restored = decodeTGA(encodeTGA(image));

    expect(Array.from(restored.data.slice(0, 4))).toEqual([12, 34, 56, 255]);
  });

  it('(254,254,254) は不透明な白として残る', () => {
    // 白目などに塗る「不透明な白」。透明にしてはいけない
    const image = makeImage([[254, 254, 254, 255]]);

    const restored = decodeTGA(encodeTGA(image));

    expect(Array.from(restored.data.slice(0, 4))).toEqual([254, 254, 254, 255]);
  });

  it('純白の画素は読み込み時に透明になる', () => {
    const image = makeImage([[255, 255, 255, 255]]);

    const restored = decodeTGA(encodeTGA(image));

    expect(restored.data[3]).toBe(0);
  });

  it('複数画素でも位置がずれない', () => {
    const image = makeImage([
      [10, 20, 30, 255],
      [200, 30, 40, 0],
      [40, 50, 60, 255],
    ]);

    const restored = decodeTGA(encodeTGA(image));

    expect(Array.from(restored.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    expect(restored.data[7]).toBe(0);
    expect(Array.from(restored.data.slice(8, 12))).toEqual([40, 50, 60, 255]);
  });
});

/**
 * 右→左に詰められた TGA。
 * ⚠️ 見落とすと左右が反転した画で開く。書き出す機械によっては立つビット。
 */
describe('右→左格納 (descriptor bit 4)', () => {
  /** 2x1 の非圧縮 TGA を作る (左が赤・右が青) */
  function twoPixelTga(descriptor: number): ArrayBuffer {
    const buf = new ArrayBuffer(18 + 2 * 4);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    view.setUint8(2, 2); // 非圧縮 True-Color
    view.setUint16(12, 2, true);
    view.setUint16(14, 1, true);
    view.setUint8(16, 32);
    view.setUint8(17, descriptor);
    // 格納順は BGRA
    bytes.set([0, 0, 255, 255], 18); // 赤
    bytes.set([255, 0, 0, 255], 22); // 青
    return buf;
  }

  it('ビットが無ければ、そのままの並び', () => {
    const img = decodeTGA(twoPixelTga(0x20)); // top-down のみ

    expect([img.data[0], img.data[1], img.data[2]]).toEqual([255, 0, 0]); // 左が赤
    expect([img.data[4], img.data[5], img.data[6]]).toEqual([0, 0, 255]); // 右が青
  });

  it('ビットが立っていれば左右を入れ替える', () => {
    const img = decodeTGA(twoPixelTga(0x20 | 0x10));

    expect([img.data[0], img.data[1], img.data[2]]).toEqual([0, 0, 255]); // 左が青
    expect([img.data[4], img.data[5], img.data[6]]).toEqual([255, 0, 0]); // 右が赤
  });
});
