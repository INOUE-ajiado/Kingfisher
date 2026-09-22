import { describe, it, expect } from 'vitest';
import { fitTransformFor, isUserAdjusted, sizeKeyOf, FIT_MARGIN_PX } from './canvasFit';

const T = (scale: number, offsetX = 0, offsetY = 0, rotation = 0) => ({
  scale,
  offsetX,
  offsetY,
  rotation,
});

describe('自動フィットの倍率', () => {
  it('表示領域の高さに収まる倍率を返す (上下の余白を引く)', () => {
    const fit = fitTransformFor(1000 + FIT_MARGIN_PX, 500, T(1));
    expect(fit?.scale).toBeCloseTo(2, 6);
  });

  it('位置は原点へ戻す', () => {
    const fit = fitTransformFor(548, 500, T(1, 300, -200));
    expect(fit?.offsetX).toBe(0);
    expect(fit?.offsetY).toBe(0);
  });

  it('回転ビューの角度は落とさない', () => {
    // ⚠️ ここが落ちると、コマを送るたびに傾けた向きが戻ってしまう
    const fit = fitTransformFor(548, 500, T(1, 0, 0, 90));
    expect(fit?.rotation).toBe(90);
  });

  it('倍率の上限と下限を守る', () => {
    expect(fitTransformFor(10000, 100, T(1))?.scale).toBe(3.0);
    expect(fitTransformFor(148, 10000, T(1))?.scale).toBe(0.2);
  });

  it('高さが取れないときは合わせない', () => {
    expect(fitTransformFor(FIT_MARGIN_PX, 500, T(1))).toBeNull();
    expect(fitTransformFor(548, 0, T(1))).toBeNull();
  });
});

describe('自分で動かしたかの判定', () => {
  it('まだ一度も自動で合わせていなければ「触っていない」', () => {
    expect(isUserAdjusted(null, T(2.5))).toBe(false);
  });

  it('自動で合わせた値のままなら「触っていない」', () => {
    expect(isUserAdjusted(T(2), T(2))).toBe(false);
  });

  it('倍率や位置が変わっていれば「触った」', () => {
    expect(isUserAdjusted(T(2), T(2.5))).toBe(true);
    expect(isUserAdjusted(T(2), T(2, 40))).toBe(true);
  });

  it('角度だけの違いは「触った」に数えない', () => {
    // 自動フィットは角度を変えないので、数えるとその面が二度と合わなくなる
    expect(isUserAdjusted(T(2, 0, 0, 0), T(2, 0, 0, 45))).toBe(false);
  });
});

describe('大きさの鍵', () => {
  it('同じ大きさなら同じ鍵', () => {
    expect(sizeKeyOf({ width: 1920, height: 1080 })).toBe('1920x1080');
    expect(sizeKeyOf(null)).toBeNull();
  });
});
