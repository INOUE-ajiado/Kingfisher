import { describe, it, expect } from 'vitest';
import {
  bakePegTransform,
  detectPegHoles,
  pegGeometryDiff,
  pegTransformTo,
  referenceFromDetection,
} from './pegStabilizer';

/**
 * タップ穴の自動検出。
 *
 * ここで守りたいのは 3 つ。
 *  - 画の中の黒を穴と取り違えないこと (探すのは紙の端の帯だけ)
 *  - 見つからないときに理由を返すこと (黙って 0 を返さない)
 *  - ずれた紙を基準へ重ねる補正量が、実際に重なる値であること
 */

const W = 800;
const H = 600;

/** 白い紙を作る */
function blankPaper(width = W, height = H): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return data;
}

/** 黒い楕円を置く (スキャンしたタップ穴のつもり) */
function punch(
  data: Uint8ClampedArray,
  width: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const idx = (y * width + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 255;
    }
  }
}

/** 上タップの紙。offsetX / offsetY / 傾き (度) を与えてずらせる */
function paperWithPegs(offsetX = 0, offsetY = 0, angleDeg = 0, width = W, height = H) {
  const data = blankPaper(width, height);
  const cx = width / 2 + offsetX;
  const cy = 60 + offsetY;
  const spacing = 220;
  const rad = (angleDeg * Math.PI) / 180;

  const place = (dx: number, rx: number, ry: number) => {
    const x = cx + dx * Math.cos(rad);
    const y = cy + dx * Math.sin(rad);
    punch(data, width, x, y, rx, ry);
  };

  place(-spacing, 11, 11); // 左の丸穴
  place(0, 18, 10); // 中央の長円
  place(spacing, 11, 11); // 右の丸穴
  return data;
}

describe('タップ穴の検出', () => {
  it('上端の 3 つの穴を、左・中央・右の順で返す', () => {
    const result = detectPegHoles(paperWithPegs(), W, H);

    expect(result.detected).toBe(true);
    expect(result.edge).toBe('top');
    expect(result.holes).toHaveLength(3);
    expect(result.holes[0].x).toBeLessThan(result.holes[1].x);
    expect(result.holes[1].x).toBeLessThan(result.holes[2].x);

    // 中央の穴と傾き
    expect(result.center.x).toBeCloseTo(W / 2, 0);
    expect(result.center.y).toBeCloseTo(60, 0);
    expect(Math.abs(result.angle)).toBeLessThan(0.5);
    expect(result.spacing).toBeGreaterThan(200);
  });

  it('傾いた紙の傾きを読む', () => {
    const result = detectPegHoles(paperWithPegs(0, 0, 2), W, H);

    expect(result.detected).toBe(true);
    expect(result.angle).toBeGreaterThan(1.5);
    expect(result.angle).toBeLessThan(2.5);
  });

  it('下タップの紙も見つける', () => {
    const data = blankPaper();
    punch(data, W, W / 2 - 220, H - 60, 11, 11);
    punch(data, W, W / 2, H - 60, 18, 10);
    punch(data, W, W / 2 + 220, H - 60, 11, 11);

    const result = detectPegHoles(data, W, H);
    expect(result.detected).toBe(true);
    expect(result.edge).toBe('bottom');
  });

  it('絵の中の黒を穴と取り違えない', () => {
    // ⚠️ 全面を走査していた頃は、画面中央の塗りつぶしを穴として拾っていた
    const data = blankPaper();
    punch(data, W, W / 2 - 220, H / 2, 11, 11);
    punch(data, W, W / 2, H / 2, 18, 10);
    punch(data, W, W / 2 + 220, H / 2, 11, 11);

    const result = detectPegHoles(data, W, H);
    expect(result.detected).toBe(false);
  });

  it('見つからないときは理由を返す (黙って 0 を返さない)', () => {
    const result = detectPegHoles(blankPaper(), W, H);

    expect(result.detected).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.holes).toHaveLength(0);
  });

  it('Kingfisher の読み込み (紙が透明・穴が黒) でも見つける', () => {
    // ⚠️ decodeTGA は純白を alpha 0 にするので、紙の地の方が透明になる。
    // 透明を穴とみなしていた頃は、紙全体がひとつの塊になって何も見つからなかった
    const data = paperWithPegs();
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (data[o] === 255 && data[o + 1] === 255 && data[o + 2] === 255) data[o + 3] = 0;
    }

    const result = detectPegHoles(data, W, H);
    expect(result.detected).toBe(true);
    expect(result.holes).toHaveLength(3);
    expect(result.center.x).toBeCloseTo(W / 2, 0);
  });

  it('穴が真っ黒でなくても (灰色でも) 見つける', () => {
    // ⚠️ スキャンの露出は素材ごとに違う。固定のしきい値だけだと、
    // 灰色に写った穴を取りこぼす (2026-09-01 の報告)
    const data = blankPaper();
    const grey = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const o = (y * W + x) * 4;
          data[o] = 120; data[o + 1] = 120; data[o + 2] = 120; data[o + 3] = 255;
        }
      }
    };
    grey(W / 2 - 220, 60, 12);
    grey(W / 2, 60, 15);
    grey(W / 2 + 220, 60, 12);

    const result = detectPegHoles(data, W, H);
    expect(result.detected).toBe(true);
    expect(result.holes).toHaveLength(3);
  });

  it('大きな画像でも穴の位置を細かく決める (間引きの刻みに丸めない)', () => {
    // ⚠️ 間引いた格子の重心をそのまま使うと、大きなスキャンでは 2〜3px 刻みになり、
    // その誤差がそのまま補正のずれになる
    // ⚠️ 間引きの刻みが 3px になる大きさ (長辺 4200 → step 3)
    const BW = 4200;
    const BH = 1200;
    const data = new Uint8ClampedArray(BW * BH * 4);
    data.fill(255);
    const put = (cx: number, cy: number, r: number) => {
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const o = (y * BW + x) * 4;
          data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
        }
    };
    // 中央の穴を x = 1400.5 に置く (間引き 2px の格子には乗らない位置)
    put(2100.5, 150.5, 34);
    put(2100.5 - 900, 150.5, 26);
    put(2100.5 + 900, 150.5, 26);

    const result = detectPegHoles(data, BW, BH);
    expect(result.detected).toBe(true);
    expect(Math.abs(result.center.x - 2100.5)).toBeLessThan(0.5);
    expect(Math.abs(result.center.y - 150.5)).toBeLessThan(0.5);
    // ⚠️ 間引いた格子のままだと、大きさが刻み (2px) の倍数に丸まる。
    // 元の解像度で取り直していれば、直径 69px がそのまま出る
    expect(result.holes[1].width).toBe(68);
    expect(result.holes[1].height).toBe(68);
  });

  it('しきい値を手で決めたときは、その値だけで探す', () => {
    // ⚠️ 手で決めた値に勝手な候補を混ぜると、「この値でどう見えるか」を確かめられない
    const data = blankPaper();
    const grey = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const o = (y * W + x) * 4;
          data[o] = 150; data[o + 1] = 150; data[o + 2] = 150; data[o + 3] = 255;
        }
    };
    grey(W / 2 - 220, 60, 12);
    grey(W / 2, 60, 15);
    grey(W / 2 + 220, 60, 12);

    // 60 以下だけを穴とみなす → 150 の穴は見つからない
    expect(detectPegHoles(data, W, H, { autoThreshold: false, threshold: 60 }).detected).toBe(false);
    // 180 まで広げれば見つかる
    expect(detectPegHoles(data, W, H, { autoThreshold: false, threshold: 180 }).detected).toBe(true);
  });

  it('探索範囲を広げると、内側にある穴も見つかる', () => {
    const data = blankPaper();
    // 上端から 40% あたりに穴がある紙 (余白の大きいスキャン)
    const y = Math.round(H * 0.38);
    punch(data, W, W / 2 - 220, y, 11, 11);
    punch(data, W, W / 2, y, 18, 10);
    punch(data, W, W / 2 + 220, y, 11, 11);

    expect(detectPegHoles(data, W, H, { searchRatio: 0.28 }).detected).toBe(false);
    expect(detectPegHoles(data, W, H, { searchRatio: 0.5 }).detected).toBe(true);
  });

  it('失敗の説明に、どこで何個まで行ったかが入る', () => {
    // ⚠️ 「0 個でした」だけでは、しきい値が悪いのか大きさの見当が外れているのか
    // 分からず、次に何を直せばよいか決められない
    const data = blankPaper();
    // 大きすぎる黒い帯 (穴ではない) を上端に置く
    for (let y = 30; y < 90; y++) {
      for (let x = 100; x < W - 100; x++) {
        const o = (y * W + x) * 4;
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
      }
    }

    const result = detectPegHoles(data, W, H);
    expect(result.detected).toBe(false);
    expect(result.message).toContain('もっとも近かったのは');
    expect(result.message).toContain('大きすぎ');
    expect(result.message).toContain('試した順');
  });

  it('抜けて透明になった穴も拾う (紙が不透明な素材)', () => {
    const data = blankPaper();
    const clear = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          data[(y * W + x) * 4 + 3] = 0;
        }
      }
    };
    clear(W / 2 - 220, 60, 11);
    clear(W / 2, 60, 14);
    clear(W / 2 + 220, 60, 11);

    expect(detectPegHoles(data, W, H).detected).toBe(true);
  });
});

describe('基準へ合わせる補正量', () => {
  it('ずれた紙を基準へ重ねる (平行移動だけで)', () => {
    const base = detectPegHoles(paperWithPegs(), W, H);
    const reference = referenceFromDetection(base);

    // 右へ 12px・下へ 7px ずれて、1.5 度傾いた紙
    const shifted = detectPegHoles(paperWithPegs(12, 7, 1.5), W, H);
    const t = pegTransformTo(shifted, reference);

    // ⚠️ 本家に合わせて回転も拡大縮小もしない
    expect(t.rotation).toBe(0);
    expect(t.scale).toBe(1);

    // 動かしたあとの中央穴が、基準の位置に重なること
    expect(shifted.center.x + t.offsetX).toBeCloseTo(reference.center.x, 1);
    expect(shifted.center.y + t.offsetY).toBeCloseTo(reference.center.y, 1);
  });

  it('傾きと間隔の食い違いは、補正せずに測って返す (信用してよいかの判断に使う)', () => {
    const reference = referenceFromDetection(detectPegHoles(paperWithPegs(), W, H));
    const tilted = detectPegHoles(paperWithPegs(0, 0, 1.5), W, H);

    const diff = pegGeometryDiff(tilted, reference);

    expect(diff.angleDiff).toBeGreaterThan(1);
    expect(diff.angleDiff).toBeLessThan(2);
    expect(diff.spacingRatio).toBeGreaterThan(0.98);
    expect(diff.spacingRatio).toBeLessThan(1.02);
  });

  it('検出できていなければ動かさない', () => {
    const none = detectPegHoles(blankPaper(), W, H);
    const reference = referenceFromDetection(detectPegHoles(paperWithPegs(), W, H));

    expect(pegTransformTo(none, reference, W, H)).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 });
  });
});

describe('補正の焼き込み', () => {
  it('ずれた紙を焼き込むと、穴が基準の位置へ来る', () => {
    const reference = referenceFromDetection(detectPegHoles(paperWithPegs(), W, H));

    const shiftedData = paperWithPegs(14, 9);
    const shifted = detectPegHoles(shiftedData, W, H);
    const transform = pegTransformTo(shifted, reference);

    const baked = bakePegTransform(shiftedData, W, H, transform);
    const after = detectPegHoles(baked, W, H);

    expect(after.detected).toBe(true);
    expect(after.center.x).toBeCloseTo(reference.center.x, -0.5);
    expect(after.center.y).toBeCloseTo(reference.center.y, -0.5);
  });

  it('傾いた紙でも、穴の位置は合う (傾きは残る = 本家と同じ)', () => {
    const reference = referenceFromDetection(detectPegHoles(paperWithPegs(), W, H));

    const tiltedData = paperWithPegs(14, 9, 1.5);
    const tilted = detectPegHoles(tiltedData, W, H);
    const baked = bakePegTransform(tiltedData, W, H, pegTransformTo(tilted, reference));
    const after = detectPegHoles(baked, W, H);

    expect(after.center.x).toBeCloseTo(reference.center.x, -0.5);
    expect(after.center.y).toBeCloseTo(reference.center.y, -0.5);
    // ⚠️ 傾きはそのまま残る。直すには回転が要り、本家はそれをしない
    expect(Math.abs(after.angle - reference.angle)).toBeGreaterThan(1);
  });

  it('穴の間隔が縮んだ紙でも、拡大縮小はしない (本家と同じ)', () => {
    // ⚠️ スキャナの送りむらで数 % 伸び縮みする。平行移動と回転だけでは重ならない
    const base = detectPegHoles(paperWithPegs(), W, H);
    const reference = referenceFromDetection(base);

    // 間隔を 3% 縮めた紙 (spacing 220 → 213)
    const data = blankPaper();
    const punchAt = (dx: number, rx: number, ry: number) => punch(data, W, W / 2 + dx, 60, rx, ry);
    punchAt(-213, 11, 11);
    punchAt(0, 18, 10);
    punchAt(213, 11, 11);

    const shrunk = detectPegHoles(data, W, H);
    const t = pegTransformTo(shrunk, reference);

    // ⚠️ 伸び縮みは補正しない。代わりに「どれだけ違うか」を測って返す
    expect(t.scale).toBe(1);
    expect(pegGeometryDiff(shrunk, reference).spacingRatio).toBeLessThan(0.98);

    const baked = bakePegTransform(data, W, H, t);
    const after = detectPegHoles(baked, W, H);
    expect(after.detected).toBe(true);
    // 真ん中の穴は基準に合う
    expect(after.center.x).toBeCloseTo(reference.center.x, -0.5);
    // ⚠️ 間隔は縮んだまま残る。直すには拡大縮小が要り、本家はそれをしない
    expect(Math.abs(after.spacing - reference.spacing)).toBeGreaterThan(4);
  });

  it('穴を取り違えたような極端な比は倍率にしない', () => {
    // ⚠️ 絵ごと拡大してしまうため、ありえない比は 1 に落とす
    const reference = { center: { x: 400, y: 60 }, angle: 0, spacing: 400 };
    const detection = detectPegHoles(paperWithPegs(), W, H); // spacing 220 前後
    expect(pegTransformTo(detection, reference, W, H).scale).toBe(1);
  });

  it('色を混ぜない (最近傍で運ぶ)', () => {
    // ⚠️ 補間すると中間色ができ、色で塗り分ける彩色データが壊れる
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      data[o] = 255; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
    }
    const baked = bakePegTransform(data, W, H, { offsetX: 3.5, offsetY: 2.5, rotation: 1.2, scale: 1.02 });

    const colors = new Set<string>();
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (baked[o + 3] === 0) continue;
      colors.add(`${baked[o]},${baked[o + 1]},${baked[o + 2]}`);
    }
    expect(Array.from(colors)).toEqual(['255,0,0']);
  });

  it('はみ出したところは透明にする (純白 = 透明の規約)', () => {
    const data = paperWithPegs();
    const baked = bakePegTransform(data, W, H, { offsetX: 40, offsetY: 0, rotation: 0, scale: 1 });

    // 左端 (元画像の外から来た列) は透明
    expect(baked[(10 * W + 5) * 4 + 3]).toBe(0);
    expect(baked[(10 * W + 5) * 4]).toBe(255);
  });
});
