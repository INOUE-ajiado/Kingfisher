import { describe, it, expect } from 'vitest';
import { describeCanvasFit, formatSpread, PegSample, spreadOf, summarizePegBatch } from './pegReport';

/**
 * タップ補正の精度を詰めるための数値。
 *
 * ⚠️ 平均と標準偏差は使わない。誤検出が 1 枚混ざるだけで、
 * 全体がぶれているように見えてしまう。
 */

function sample(path: string, offsetX: number, offsetY = 0, angleDiff = 0.002, spacingRatio = 1): PegSample {
  return { path, offsetX, offsetY, angleDiff, spacingRatio };
}

describe('ばらつき', () => {
  it('中央値・範囲・散らばりを出す', () => {
    const out = spreadOf([0, 0.2, -0.2, 0.4, -0.4]);

    expect(out.count).toBe(5);
    expect(out.median).toBe(0);
    expect(out.min).toBe(-0.4);
    expect(out.max).toBe(0.4);
    expect(out.deviation).toBe(0.2);
  });

  it('外れ値が 1 つ混ざっても、本体の姿が残る', () => {
    const clean = spreadOf([0, 0.1, -0.1, 0.2, -0.2]);
    const withOutlier = spreadOf([0, 0.1, -0.1, 0.2, -0.2, 322]);

    // 中央値もばらつきもほとんど動かない (平均・標準偏差なら大きく動く)
    expect(Math.abs(withOutlier.median - clean.median)).toBeLessThan(0.1);
    expect(Math.abs(withOutlier.deviation - clean.deviation)).toBeLessThan(0.15);
    // ⚠️ 範囲だけは大きく開く。これが「数枚だけ外れている」の手がかりになる
    expect(withOutlier.max).toBe(322);
  });

  it('空でも落ちない', () => {
    expect(spreadOf([])).toEqual({ count: 0, median: 0, min: 0, max: 0, deviation: 0 });
  });

  it('読みやすい 1 行にする', () => {
    expect(formatSpread(spreadOf([0, 0.5, -0.5]), 'px')).toBe(
      '中央値 0.00px / 範囲 -0.50〜0.50px / ばらつき 0.50px'
    );
  });
});

describe('束のまとめ', () => {
  const batch: PegSample[] = [
    sample('a/s1.jpg', 0.1, -0.2),
    sample('a/s2.jpg', -0.3, 0.4),
    sample('a/s3.jpg', 0.2, 0.1),
    sample('a/s4.jpg', 0.0, -0.1),
  ];

  it('4 つの指標を並べる', () => {
    const lines = summarizePegBatch(batch);

    expect(lines[0]).toContain('横のずれ');
    expect(lines[1]).toContain('縦のずれ');
    expect(lines[2]).toContain('穴の並びの差');
    expect(lines[3]).toContain('穴の間隔の比');
  });

  it('揃っているときは名指ししない', () => {
    expect(summarizePegBatch(batch).some((l) => l.includes('中央値から離れている順'))).toBe(false);
  });

  it('離れているコマを名指しする (誤検出を追うため)', () => {
    const lines = summarizePegBatch([...batch, sample('a/bad.jpg', -322.5, 0)]);
    const named = lines.find((l) => l.includes('中央値から離れている順'));

    expect(named).toBeDefined();
    expect(named).toContain('bad.jpg');
    expect(named).toContain('322');
  });

  it('測れたコマが無ければ、そう書く', () => {
    expect(summarizePegBatch([])).toEqual(['補正量を測れたコマがありません']);
  });
});

/**
 * 画寸を揃えるときの切り取り。
 *
 * ⚠️ 切り取りは元に戻せない。基準に選んだ 1 枚が束の中で小さいと、
 * 全部が黙って切られる (2026-09-02 の実データで 37 枚すべてが下を 15〜35px、
 * 5 枚が右を最大 902px 切られていた)。
 */
describe('揃える先と切り取り', () => {
  const sizes = [
    { path: 'a.jpg', width: 2333, height: 1642 },
    { path: 'b.jpg', width: 3251, height: 1640 },
    { path: 'c.jpg', width: 2331, height: 1657 },
  ];

  it('束の画寸の幅を出す', () => {
    const lines = describeCanvasFit(sizes, { width: 2349, height: 1622 });

    expect(lines[0]).toContain('幅 2331〜3251');
    expect(lines[0]).toContain('高さ 1640〜1657');
    expect(lines[0]).toContain('2349x1622');
  });

  it('切られる枚数と最大量を知らせる', () => {
    const lines = describeCanvasFit(sizes, { width: 2349, height: 1622 });

    expect(lines[1]).toContain('右を最大 902px (1 枚)');
    expect(lines[1]).toContain('下を最大 35px (3 枚)');
  });

  it('全部が収まるなら切り取りの行を出さない', () => {
    const lines = describeCanvasFit(sizes, { width: 3300, height: 1700 });

    expect(lines).toHaveLength(1);
  });

  it('空なら何も言わない', () => {
    expect(describeCanvasFit([], { width: 100, height: 100 })).toEqual([]);
  });
});
