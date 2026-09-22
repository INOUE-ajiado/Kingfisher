import { describe, it, expect, beforeEach } from 'vitest';
import {
  tintOnionPixels,
  onionAlpha,
  tintedOnionCanvas,
  clearOnionCache,
  onionCacheSize,
} from './onionSkin';

const RED = { r: 200, g: 0, b: 0 };

/** 画素 1 つぶんの並び */
const px = (r: number, g: number, b: number, a: number) => new Uint8ClampedArray([r, g, b, a]);

describe('オニオンスキンの色づけ', () => {
  it('白いところは指定色になる (monochrome)', () => {
    const dst = new Uint8ClampedArray(4);
    tintOnionPixels(px(255, 255, 255, 255), dst, RED, 'monochrome');
    expect([dst[0], dst[1], dst[2], dst[3]]).toEqual([200, 0, 0, 255]);
  });

  it('暗いところは暗いまま染まる (monochrome)', () => {
    const dst = new Uint8ClampedArray(4);
    tintOnionPixels(px(0, 0, 0, 255), dst, RED, 'monochrome');
    expect([dst[0], dst[1], dst[2]]).toEqual([0, 0, 0]);
  });

  it('half-color は元の色との中間', () => {
    const dst = new Uint8ClampedArray(4);
    tintOnionPixels(px(100, 100, 100, 255), dst, RED, 'half-color');
    expect([dst[0], dst[1], dst[2]]).toEqual([150, 50, 50]);
  });

  it('original は元の色のまま', () => {
    const dst = new Uint8ClampedArray(4);
    tintOnionPixels(px(12, 34, 56, 255), dst, RED, 'original');
    expect([dst[0], dst[1], dst[2], dst[3]]).toEqual([12, 34, 56, 255]);
  });

  it('透明な画素は触らない', () => {
    const dst = new Uint8ClampedArray(4);
    tintOnionPixels(px(255, 255, 255, 0), dst, RED, 'monochrome');
    expect([dst[0], dst[1], dst[2], dst[3]]).toEqual([0, 0, 0, 0]);
  });

  it('不透明度はそのまま持ち越す', () => {
    const dst = new Uint8ClampedArray(4);
    tintOnionPixels(px(255, 255, 255, 128), dst, RED, 'monochrome');
    expect(dst[3]).toBe(128);
  });
});

describe('重ねる濃さ', () => {
  it('1 枚目は開始の濃さ', () => {
    expect(onionAlpha(30, 10, 1)).toBeCloseTo(0.3, 6);
  });

  it('奥へ行くほど薄くなる', () => {
    expect(onionAlpha(30, 10, 3)).toBeCloseTo(0.1, 6);
  });

  it('薄くなりすぎない (下限 0.05)', () => {
    expect(onionAlpha(30, 10, 10)).toBe(0.05);
  });
});

describe('色づけした絵の使い回し', () => {
  /** canvas が無い環境でも試せるように、最低限の偽物を用意する */
  const fakeCanvas = () => {
    let created = 0;
    const make = () => {
      created++;
      const data = { data: new Uint8ClampedArray(16) };
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: () => data,
          putImageData: () => {},
        }),
      } as unknown as HTMLCanvasElement;
    };
    return { make, count: () => created };
  };

  beforeEach(() => clearOnionCache());

  const frame = () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16) });

  it('同じコマ・同じ色なら作り直さない', () => {
    const f = frame();
    const cv = fakeCanvas();
    tintedOnionCanvas(f, RED, 'monochrome', cv.make);
    tintedOnionCanvas(f, RED, 'monochrome', cv.make);
    expect(cv.count()).toBe(1);
  });

  it('色を変えたら作り直す', () => {
    const f = frame();
    const cv = fakeCanvas();
    tintedOnionCanvas(f, RED, 'monochrome', cv.make);
    tintedOnionCanvas(f, { r: 0, g: 0, b: 255 }, 'monochrome', cv.make);
    expect(cv.count()).toBe(2);
  });

  it('出し方を変えたら作り直す', () => {
    const f = frame();
    const cv = fakeCanvas();
    tintedOnionCanvas(f, RED, 'monochrome', cv.make);
    tintedOnionCanvas(f, RED, 'half-color', cv.make);
    expect(cv.count()).toBe(2);
  });

  it('別のコマは別に持つ', () => {
    const cv = fakeCanvas();
    tintedOnionCanvas(frame(), RED, 'monochrome', cv.make);
    tintedOnionCanvas(frame(), RED, 'monochrome', cv.make);
    expect(cv.count()).toBe(2);
    expect(onionCacheSize()).toBe(2);
  });

  it('溜め込みすぎない', () => {
    const cv = fakeCanvas();
    for (let i = 0; i < 100; i++) tintedOnionCanvas(frame(), RED, 'monochrome', cv.make);
    expect(onionCacheSize()).toBeLessThanOrEqual(48);
  });
});
