import { describe, it, expect } from 'vitest';
import {
  describePadding,
  formatSpread,
  PegSample,
  spreadOf,
  summarizePegBatch,
  unionCanvas,
} from './pegReport';

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
 * どのコマも切らずに収まる画寸。
 * ⚠️ 横長の素材 (オートフィードで長く取り込まれたコマ) を絶対に切らないための決め方。
 */
describe('切らずに収まる画寸', () => {
  it('幅と高さを別々に最大へ合わせる', () => {
    const out = unionCanvas([
      { width: 2333, height: 1642 },
      { width: 3251, height: 1640 },
      { width: 2331, height: 1657 },
    ]);

    // ⚠️ 幅が最大のコマと高さが最大のコマは別。どちらも切らない画寸にする
    expect(out).toEqual({ width: 3251, height: 1657 });
  });

  it('右や下へ動かす分も足す', () => {
    const out = unionCanvas([
      { width: 100, height: 100, offsetX: 12, offsetY: 0 },
      { width: 100, height: 100, offsetX: 0, offsetY: 7 },
    ]);

    expect(out).toEqual({ width: 112, height: 107 });
  });

  it('左や上へ動かす分は足さない (画は縮まない)', () => {
    expect(unionCanvas([{ width: 100, height: 100, offsetX: -5, offsetY: -5 }])).toEqual({
      width: 100,
      height: 100,
    });
  });

  it('空なら 0', () => {
    expect(unionCanvas([])).toEqual({ width: 0, height: 0 });
  });

  it('埋める量を伝える', () => {
    const text = describePadding(
      [
        { path: 'a.jpg', width: 2333, height: 1642 },
        { path: 'b.jpg', width: 3251, height: 1657 },
      ],
      { width: 3251, height: 1657 }
    );

    expect(text).toContain('右を最大 918px (1 枚)');
    expect(text).toContain('下を最大 15px (1 枚)');
    expect(text).toContain('切り取りはありません');
  });

  it('全部同じならそう言う', () => {
    const same = [{ path: 'a.jpg', width: 10, height: 10 }];
    expect(describePadding(same, { width: 10, height: 10 })).toContain('埋める縁はありません');
  });
});
