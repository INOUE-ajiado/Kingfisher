import { describe, it, expect } from 'vitest';
import {
  fromVideoPosition,
  isPointerFresh,
  toVideoPosition,
  videoContentRect,
} from './rushPointerMath';

describe('映像が映っている四角', () => {
  it('横長の枠では左右に余白ができる', () => {
    const r = videoContentRect(1000, 500, 1920, 1080); // 枠 2.0 : 映像 1.78
    expect(r.height).toBe(500);
    expect(Math.round(r.width)).toBe(889);
    expect(Math.round(r.x)).toBe(56);
    expect(r.y).toBe(0);
  });

  it('縦長の枠では上下に余白ができる', () => {
    const r = videoContentRect(800, 800, 1920, 1080);
    expect(r.width).toBe(800);
    expect(Math.round(r.height)).toBe(450);
    expect(Math.round(r.y)).toBe(175);
  });

  it('映像の大きさが分からないうちは枠いっぱいとみなす', () => {
    expect(videoContentRect(600, 400, 0, 0)).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  });

  it('枠が無い間は空の四角', () => {
    expect(videoContentRect(0, 0, 1920, 1080)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('指した位置の受け渡し', () => {
  it('窓の形が違っても、映像の同じ場所を指す', () => {
    // オペレーター: 1000x500 の枠。映像の中央やや右上を指す
    const opRect = videoContentRect(1000, 500, 1920, 1080);
    const position = toVideoPosition(opRect.x + opRect.width * 0.75, opRect.y + opRect.height * 0.25, opRect);
    expect(position).not.toBeNull();
    expect(position!.x).toBeCloseTo(0.75);
    expect(position!.y).toBeCloseTo(0.25);

    // 視聴者: 縦長の別の窓。同じ割合の場所に出る
    const viewerRect = videoContentRect(600, 900, 1920, 1080);
    const drawn = fromVideoPosition(position!, viewerRect);
    expect(drawn.left).toBeCloseTo(viewerRect.x + viewerRect.width * 0.75);
    expect(drawn.top).toBeCloseTo(viewerRect.y + viewerRect.height * 0.25);
  });

  it('余白 (レターボックス) の上は映像の外として扱う', () => {
    const rect = videoContentRect(1000, 500, 1920, 1080); // 左右に 56px ずつ余白
    expect(toVideoPosition(10, 250, rect)).toBeNull();
    expect(toVideoPosition(990, 250, rect)).toBeNull();
    expect(toVideoPosition(500, 250, rect)).not.toBeNull();
  });

  it('端ちょうどは映像の中', () => {
    const rect = videoContentRect(1000, 500, 1000, 500);
    expect(toVideoPosition(0, 0, rect)).toEqual({ x: 0, y: 0 });
    expect(toVideoPosition(1000, 500, rect)).toEqual({ x: 1, y: 1 });
  });
});

describe('古いポインターは消す', () => {
  it('5 秒を過ぎたら出さない (送り手が落ちた場合)', () => {
    expect(isPointerFresh(1000, 5999)).toBe(true);
    expect(isPointerFresh(1000, 6000)).toBe(false);
  });
});

describe('ポインターの見た目', () => {
  it('同じ人はいつも同じ色、違う人は散らばる', async () => {
    const { defaultPointerColor, POINTER_COLORS } = await import('./rushPointerMath');
    expect(defaultPointerColor('op@ajiado.co.jp')).toBe(defaultPointerColor('op@ajiado.co.jp'));
    const colors = new Set(
      ['a@ajiado.co.jp', 'b@ajiado.co.jp', 'c@ajiado.co.jp', 'd@ajiado.co.jp'].map(defaultPointerColor)
    );
    expect(colors.size).toBeGreaterThan(1);
    for (const c of colors) expect(POINTER_COLORS.some((p) => p.value === c)).toBe(true);
  });

  it('大きさは決めた範囲に収める', async () => {
    const { clampPointerSize, MIN_POINTER_SIZE, MAX_POINTER_SIZE, DEFAULT_POINTER_SIZE } = await import(
      './rushPointerMath'
    );
    expect(clampPointerSize(4)).toBe(MIN_POINTER_SIZE);
    expect(clampPointerSize(100)).toBe(MAX_POINTER_SIZE);
    expect(clampPointerSize(24.4)).toBe(24);
    expect(clampPointerSize(Number.NaN)).toBe(DEFAULT_POINTER_SIZE);
  });

  it('色の形を検査し、透過色へ直せる', async () => {
    const { isPointerColor, withAlpha } = await import('./rushPointerMath');
    expect(isPointerColor('#ff2d2d')).toBe(true);
    expect(isPointerColor('red')).toBe(false);
    expect(isPointerColor('#fff')).toBe(false);
    expect(withAlpha('#ff2d2d', 0.5)).toBe('rgba(255, 45, 45, 0.5)');
    expect(withAlpha('おかしな値', 1)).toBe('rgba(255, 45, 45, 1)');
  });
});

describe('ぼかしと描画', () => {
  it('ぼかしは 0〜1 に収め、上げるほど にじみが広がる', async () => {
    const { clampPointerBlur, pointerGlow, DEFAULT_POINTER_BLUR } = await import('./rushPointerMath');
    expect(clampPointerBlur(-1)).toBe(0);
    expect(clampPointerBlur(5)).toBe(1);
    expect(clampPointerBlur(Number.NaN)).toBe(DEFAULT_POINTER_BLUR);

    const sharp = pointerGlow(20, 0);
    const soft = pointerGlow(20, 1);
    expect(sharp.core).toBeGreaterThan(soft.core); // くっきり = 芯が大きい
    expect(soft.blurPx).toBeGreaterThan(sharp.blurPx);
  });

  it('線の太さは映像の大きさに合わせて変わる (見た目の太さが揃う)', async () => {
    const { strokeWidthPx, clampStrokeSize } = await import('./rushPointerMath');
    expect(strokeWidthPx(6, 1280)).toBeCloseTo(6);
    expect(strokeWidthPx(6, 640)).toBeCloseTo(3);
    expect(strokeWidthPx(6, 0)).toBe(6);
    expect(clampStrokeSize(99)).toBe(24);
    expect(clampStrokeSize(0)).toBe(2);
  });

  it('描いた線は 3 秒で消え、最後の 1 秒で薄くなる', async () => {
    const { strokeOpacity } = await import('./rushPointerMath');
    expect(strokeOpacity(0, 0)).toBe(1);
    expect(strokeOpacity(0, 1999)).toBe(1);
    expect(strokeOpacity(0, 2500)).toBeCloseTo(0.5);
    expect(strokeOpacity(0, 3000)).toBe(0);
    expect(strokeOpacity(0, 99999)).toBe(0);
  });

  it('点の並びを文字列にして戻せる', async () => {
    const { encodeStrokePoints, decodeStrokePoints } = await import('./rushPointerMath');
    const points = [{ x: 0.1234, y: 0.5678 }, { x: 0.9, y: 0.1 }];
    const encoded = encodeStrokePoints(points);
    expect(encoded).toBe('0.1234,0.5678|0.9000,0.1000');
    expect(decodeStrokePoints(encoded)).toEqual([{ x: 0.1234, y: 0.5678 }, { x: 0.9, y: 0.1 }]);
    expect(decodeStrokePoints('')).toEqual([]);
    expect(decodeStrokePoints('こわれた値')).toEqual([]);
  });
});
