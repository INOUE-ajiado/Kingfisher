import { describe, it, expect } from 'vitest';
import { laneCount, runInLanes } from './jobPool';

/**
 * 並行に流す割り振り。
 * 守りたいのは「同時に走る数が決めた本数を超えない」「1 件の失敗で止まらない」
 * 「結果が入力の並び順で戻る」の 3 つ。
 */

describe('runInLanes', () => {
  it('決めた本数を超えて同時に走らせない', async () => {
    let running = 0;
    let peak = 0;

    await runInLanes(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
      return n;
    });

    expect(peak).toBe(4);
  });

  it('順番どおりに結果を返す (終わった順ではない)', async () => {
    const out = await runInLanes([30, 1, 20, 2], 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });

    expect(out.map((o) => o.value)).toEqual([30, 1, 20, 2]);
  });

  it('1 件が失敗しても残りを進める', async () => {
    const out = await runInLanes([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('読めません');
      return n;
    });

    expect(out.map((o) => o.value)).toEqual([1, undefined, 3]);
    expect(out[1].error).toContain('読めません');
  });

  it('全部を必ず 1 回ずつ処理する', async () => {
    const seen: number[] = [];
    await runInLanes(Array.from({ length: 50 }, (_, i) => i), 7, async (n) => {
      seen.push(n);
      return n;
    });

    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('本数が 0 や負でも 1 本として進む', async () => {
    const out = await runInLanes([1, 2], 0, async (n) => n);
    expect(out.map((o) => o.value)).toEqual([1, 2]);
  });

  it('空なら何もしない', async () => {
    expect(await runInLanes([], 4, async () => 1)).toEqual([]);
  });
});

describe('laneCount', () => {
  it('枚数・コア数・上限のいちばん小さいものに合わせる', () => {
    expect(laneCount(3, 16)).toBe(3);
    expect(laneCount(100, 6)).toBe(6);
    expect(laneCount(100, 32)).toBe(8);
    expect(laneCount(100, undefined)).toBe(4);
    expect(laneCount(0, 8)).toBe(1);
  });
});
