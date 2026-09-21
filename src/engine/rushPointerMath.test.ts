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
