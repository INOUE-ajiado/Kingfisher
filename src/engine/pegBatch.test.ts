import { describe, it, expect } from 'vitest';
import { PegCandidate, rejectPegOutliers } from './pegBatch';

/**
 * 誤検出の弾き方。
 *
 * もとにしたのは 2026-09-02 の実データ (42 枚のスキャン)。
 * 大半が X ≈ +18〜20px / 回転 ≈ 0.03° / 倍率 ≈ 99.9% で揃っている中に、
 * X -322px や Y -1174px / 回転 -5.8° が混ざっていた。
 */

function candidate(path: string, offsetX: number, offsetY = -1, rotation = 0.03, scale = 0.999): PegCandidate {
  return { path, transform: { offsetX, offsetY, rotation, scale } };
}

/** 揃っている 10 枚 */
const cluster = Array.from({ length: 10 }, (_, i) => candidate(`s${i}.jpg`, 18 + (i % 3) * 0.5));

describe('揃っていない 1 枚を外す', () => {
  it('横に大きくずれた 1 枚を外す', () => {
    const out = rejectPegOutliers([...cluster, candidate('bad.jpg', -322.53)]);

    expect(out.accepted.map((c) => c.path)).not.toContain('bad.jpg');
    expect(out.rejected[0].path).toBe('bad.jpg');
    expect(out.rejected[0].reason).toContain('横のずれ');
  });

  it('縦に飛んだうえ大きく傾いた 1 枚を外す (実データの _0036)', () => {
    const out = rejectPegOutliers([...cluster, candidate('bad.jpg', -270.97, -1174.73, -5.7868, 1)]);

    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reason).toContain('傾き');
  });

  it('揃っている分はそのまま通す', () => {
    const out = rejectPegOutliers(cluster);

    expect(out.accepted).toHaveLength(10);
    expect(out.rejected).toEqual([]);
    expect(out.median?.offsetX).toBeCloseTo(18.5, 1);
  });

  it('中央値は外れ値に引っ張られない (平均では駄目)', () => {
    const out = rejectPegOutliers([...cluster, candidate('a.jpg', -322), candidate('b.jpg', 900)]);

    expect(out.median?.offsetX).toBeGreaterThan(17);
    expect(out.median?.offsetX).toBeLessThan(21);
    expect(out.rejected.map((r) => r.path).sort()).toEqual(['a.jpg', 'b.jpg']);
  });

  it('枚数が少ないときは中央値で判断しない (どちらが正しいか決められない)', () => {
    const out = rejectPegOutliers([candidate('a.jpg', 18), candidate('b.jpg', 200)]);

    expect(out.median).toBeNull();
    expect(out.accepted).toHaveLength(2);
  });

  it('枚数が少なくても、明らかにおかしい値は弾く', () => {
    const out = rejectPegOutliers([candidate('a.jpg', 18), candidate('b.jpg', 20, -1, -5.79, 1)]);

    expect(out.rejected.map((r) => r.path)).toEqual(['b.jpg']);
    expect(out.rejected[0].reason).toContain('大きすぎます');
  });

  it('倍率が離れすぎている 1 枚も弾く', () => {
    const out = rejectPegOutliers([...cluster, candidate('bad.jpg', 19, -1, 0.03, 1.02)]);

    expect(out.rejected.map((r) => r.path)).toEqual(['bad.jpg']);
    expect(out.rejected[0].reason).toContain('倍率');
  });

  it('空なら何も返さない', () => {
    expect(rejectPegOutliers([])).toEqual({ accepted: [], rejected: [], median: null });
  });
});
