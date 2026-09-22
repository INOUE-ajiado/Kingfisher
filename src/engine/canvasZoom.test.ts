import { describe, it, expect } from 'vitest';
import { wheelTransform, ZOOM_MIN_SCALE, ZOOM_MAX_SCALE } from './canvasZoom';

const T = (scale: number, offsetX = 0, offsetY = 0, rotation = 0) => ({
  scale,
  offsetX,
  offsetY,
  rotation,
});

/** 400x300 の面の中央にカーソルがある状態 */
const atCenter = (deltaY: number, ctrlKey = false) => ({
  deltaX: 0,
  deltaY,
  ctrlKey,
  x: 200,
  y: 150,
  width: 400,
  height: 300,
});

describe('ホイールでの拡大縮小', () => {
  it('手前に回すと拡大、奥に回すと縮小', () => {
    expect(wheelTransform(T(1), atCenter(-100), 'mouse').scale).toBeCloseTo(1.1, 6);
    expect(wheelTransform(T(1), atCenter(100), 'mouse').scale).toBeCloseTo(1 / 1.1, 6);
  });

  it('倍率の上限と下限を守る', () => {
    expect(wheelTransform(T(ZOOM_MAX_SCALE), atCenter(-100), 'mouse').scale).toBe(ZOOM_MAX_SCALE);
    expect(wheelTransform(T(ZOOM_MIN_SCALE), atCenter(100), 'mouse').scale).toBe(ZOOM_MIN_SCALE);
  });

  it('中央で回したときは位置が動かない', () => {
    const next = wheelTransform(T(1), atCenter(-100), 'mouse');
    expect(next.offsetX).toBeCloseTo(0, 6);
    expect(next.offsetY).toBeCloseTo(0, 6);
  });

  it('カーソルの下にある点が動かない (アンカーズーム)', () => {
    // 面の左上 (0,0) で拡大する。画像上の同じ点が画面の同じ場所に残るか
    const before = T(1);
    const input = { deltaX: 0, deltaY: -100, ctrlKey: false, x: 0, y: 0, width: 400, height: 300 };
    const after = wheelTransform(before, input, 'mouse');

    // 画面座標 = 中心 + ずれ + (画像座標 * 倍率)。カーソル位置の画像座標を逆算して確かめる
    const imageX = (input.x - 200 - before.offsetX) / before.scale;
    const screenXAfter = 200 + after.offsetX + imageX * after.scale;
    expect(screenXAfter).toBeCloseTo(input.x, 6);
  });

  it('角度は持ち越す', () => {
    expect(wheelTransform(T(1, 0, 0, 30), atCenter(-100), 'mouse').rotation).toBe(30);
  });
});

describe('トラックパッド', () => {
  it('ctrl 無しの 2 本指は平行移動', () => {
    const next = wheelTransform(T(2, 10, 20), { ...atCenter(40), deltaX: 15 }, 'trackpad');
    expect(next.scale).toBe(2);
    expect(next.offsetX).toBe(10 - 15);
    expect(next.offsetY).toBe(20 - 40);
  });

  it('ctrl 付きのピンチは拡大縮小', () => {
    const next = wheelTransform(T(1), atCenter(-100, true), 'trackpad');
    expect(next.scale).toBeGreaterThan(1);
  });

  it('マウスのときは ctrl の有無で変わらない', () => {
    const a = wheelTransform(T(1), atCenter(-100, false), 'mouse');
    const b = wheelTransform(T(1), atCenter(-100, true), 'mouse');
    expect(a.scale).toBe(b.scale);
  });
});
