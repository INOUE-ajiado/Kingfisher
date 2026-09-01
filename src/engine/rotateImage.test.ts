import { describe, it, expect } from 'vitest';
import { encodeTypeFor, rotateImageData, rotateLabel } from './rotateImage';

/**
 * 回転は画素を並べ替えるだけの操作。
 * 色が混ざると、純白 = 透明の決まりが崩れて塗りが漏れる。
 */

/** 1 画素を「赤の値」だけで表した並びを作る */
function makeImage(rows: number[][]): { data: Uint8ClampedArray; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    row.forEach((v, x) => {
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    });
  });
  return { data, width, height };
}

/** 赤の値だけを行の形で取り出す */
function toRows(img: { data: Uint8ClampedArray; width: number; height: number }): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < img.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < img.width; x++) row.push(img.data[(y * img.width + x) * 4]);
    rows.push(row);
  }
  return rows;
}

describe('90 度回す', () => {
  const src = makeImage([
    [1, 2, 3],
    [4, 5, 6],
  ]);

  it('右へ回すと幅と高さが入れ替わる', () => {
    const out = rotateImageData(src.data, src.width, src.height, 'right');

    expect([out.width, out.height]).toEqual([2, 3]);
    expect(toRows(out)).toEqual([
      [4, 1],
      [5, 2],
      [6, 3],
    ]);
  });

  it('左へ回すと右の逆になる', () => {
    const out = rotateImageData(src.data, src.width, src.height, 'left');

    expect([out.width, out.height]).toEqual([2, 3]);
    expect(toRows(out)).toEqual([
      [3, 6],
      [2, 5],
      [1, 4],
    ]);
  });

  it('右に 4 回まわすと元に戻る (やり直せる操作にする)', () => {
    let cur = { data: src.data, width: src.width, height: src.height };
    for (let i = 0; i < 4; i++) {
      cur = rotateImageData(cur.data, cur.width, cur.height, 'right');
    }

    expect([cur.width, cur.height]).toEqual([3, 2]);
    expect(toRows(cur)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('右のあと左で元に戻る', () => {
    const r = rotateImageData(src.data, src.width, src.height, 'right');
    const back = rotateImageData(r.data, r.width, r.height, 'left');

    expect(toRows(back)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('透明の画素をそのまま運ぶ (色を混ぜない)', () => {
    const data = new Uint8ClampedArray([
      255, 255, 255, 0, // 透明 (純白として書き出された画素)
      10, 20, 30, 255,
    ]);

    const out = rotateImageData(data, 2, 1, 'right');

    expect(Array.from(out.data)).toEqual([255, 255, 255, 0, 10, 20, 30, 255]);
  });
});

describe('書き出す形式', () => {
  it('拡張子で決める。JPEG は品質を添える', () => {
    expect(encodeTypeFor('a/b/x.png')).toEqual({ mime: 'image/png' });
    expect(encodeTypeFor('x.JPG')).toEqual({ mime: 'image/jpeg', quality: 0.95 });
    expect(encodeTypeFor('x.jpeg').mime).toBe('image/jpeg');
    expect(encodeTypeFor('x.webp').mime).toBe('image/webp');
  });
});

describe('呼び名', () => {
  it('ログと確認の文面で揃える', () => {
    expect(rotateLabel('right')).toBe('右へ 90°');
    expect(rotateLabel('left')).toBe('左へ 90°');
  });
});
