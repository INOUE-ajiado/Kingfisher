import { describe, it, expect } from 'vitest';
import { angleFromCenter, normalizeAngle, scaleFromBoundingRect, screenToImagePoint, snapAngle } from './viewTransform';

/** 画像を倍率 scale・角度 rotation で表示したときの外接四角形 */
function rectFor(imageWidth: number, imageHeight: number, scale: number, rotationDeg: number, center = { x: 500, y: 400 }) {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const width = (imageWidth * c + imageHeight * s) * scale;
  const height = (imageWidth * s + imageHeight * c) * scale;
  return { left: center.x - width / 2, top: center.y - height / 2, width, height };
}

/** 画像の画素 → 画面座標 (テスト側で順方向を組んで、逆変換と突き合わせる) */
function imageToScreen(x: number, y: number, imageWidth: number, imageHeight: number, scale: number, rotationDeg: number, center = { x: 500, y: 400 }) {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const vx = (x - imageWidth / 2) * scale;
  const vy = (y - imageHeight / 2) * scale;
  return { clientX: center.x + vx * c - vy * s, clientY: center.y + vx * s + vy * c };
}

describe('表示の回転 (回転ビュー) の座標計算', () => {
  const W = 400;
  const H = 300;

  it('回していないときは今までどおり (倍率だけ効く)', () => {
    const rect = rectFor(W, H, 2, 0);
    expect(screenToImagePoint(rect.left, rect.top, rect, W, H, 0)).toEqual({ x: 0, y: 0 });
    expect(screenToImagePoint(rect.left + 200, rect.top + 200, rect, W, H, 0)).toEqual({ x: 100, y: 100 });
  });

  it('外接四角形から表示倍率を割り出す', () => {
    expect(scaleFromBoundingRect(rectFor(W, H, 1.5, 0), W, H, 0)).toBeCloseTo(1.5, 6);
    expect(scaleFromBoundingRect(rectFor(W, H, 1.5, 37), W, H, 37)).toBeCloseTo(1.5, 6);
    expect(scaleFromBoundingRect(rectFor(W, H, 0.4, 90), W, H, 90)).toBeCloseTo(0.4, 6);
  });

  it('どの角度・倍率でも、画面へ出した点を元の画素へ戻せる', () => {
    for (const rotation of [0, 15, 45, 90, 137, -30, 180]) {
      for (const scale of [0.3, 1, 2.5]) {
        const rect = rectFor(W, H, scale, rotation);
        for (const [x, y] of [[0, 0], [399, 299], [200, 150], [10, 280]]) {
          // 画素の中央を狙う (画素の左上ちょうどは丸めで隣に倒れる)
          const p = imageToScreen(x + 0.5, y + 0.5, W, H, scale, rotation);
          expect(screenToImagePoint(p.clientX, p.clientY, rect, W, H, rotation)).toEqual({ x, y });
        }
      }
    }
  });

  it('右へ 90 度回すと、画面の右方向が画像の上方向になる', () => {
    const rect = rectFor(W, H, 1, 90);
    const center = { x: 500, y: 400 };
    // 時計回りに 90 度回すので、画像の上側は画面の右側へ来る
    expect(screenToImagePoint(center.x + 50, center.y, rect, W, H, 90)).toEqual({ x: W / 2, y: H / 2 - 50 });
  });
});

describe('角度の扱い', () => {
  it('-180〜180 に畳む', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(540)).toBe(180);
  });

  it('15 度きざみに寄せる', () => {
    expect(snapAngle(7)).toBe(0);
    expect(snapAngle(8)).toBe(15);
    expect(snapAngle(-22)).toBe(-15);
    expect(snapAngle(352)).toBe(-15); // 345 度が最寄り
    expect(snapAngle(358)).toBe(0);
    expect(snapAngle(31, 10)).toBe(30);
  });

  it('中心から見た角度を返す', () => {
    const center = { x: 100, y: 100 };
    expect(angleFromCenter(200, 100, center)).toBeCloseTo(0, 6);
    expect(angleFromCenter(100, 200, center)).toBeCloseTo(90, 6);
    expect(angleFromCenter(0, 100, center)).toBeCloseTo(180, 6);
  });
});
