import { describe, it, expect, beforeEach } from 'vitest';
import { clearDebugLog, formatDebugLog, getDebugLog, logDebug, subscribeDebugLog, collapseRepeats, tallyByCategory, DebugLogEntry, DebugLogCategory } from './debugLog';

/**
 * 操作ログ。ここで守りたいのは 3 つ。
 *  - 開きっぱなしでも増え続けないこと (古いものから捨てる)
 *  - 描き直しの合図が届くこと (参照が変わること)
 *  - 全文コピーに、いつ・何が起きたかが揃っていること
 */

beforeEach(() => clearDebugLog());

describe('操作ログ', () => {
  it('記録した順に並ぶ', () => {
    logDebug('folder', 'フォルダを開いた');
    logDebug('cell', 'コマ移動');

    expect(getDebugLog().map((e) => e.message)).toEqual(['フォルダを開いた', 'コマ移動']);
    expect(getDebugLog()[0].seq).toBeLessThan(getDebugLog()[1].seq);
  });

  it('上限を超えたら古いものから捨てる', () => {
    for (let i = 0; i < 520; i++) logDebug('cell', `${i}`);

    const entries = getDebugLog();
    expect(entries.length).toBe(500);
    // 新しい方が残る
    expect(entries[entries.length - 1].message).toBe('519');
    expect(entries[0].message).toBe('20');
  });

  it('毎回配列を作り直す (useSyncExternalStore が描き直せる)', () => {
    const before = getDebugLog();
    logDebug('cell', '1 行');
    expect(getDebugLog()).not.toBe(before);
  });

  it('購読していれば知らせが届き、外せば止まる', () => {
    let calls = 0;
    const unsubscribe = subscribeDebugLog(() => (calls += 1));

    logDebug('cell', '1');
    logDebug('cell', '2');
    expect(calls).toBe(2);

    unsubscribe();
    logDebug('cell', '3');
    expect(calls).toBe(2);
  });

  it('全文コピーには件数と本文と内訳が入る', () => {
    logDebug('cell', 'Win A のコマ移動 0 → 1', '連動 (コマ差 0) で Win B 0 → 1');
    const text = formatDebugLog();

    expect(text).toContain('Kingfisher 操作ログ');
    expect(text).toContain('件数: 1');
    expect(text).toContain('Win A のコマ移動 0 → 1');
    expect(text).toContain('連動 (コマ差 0) で Win B 0 → 1');
  });

  it('空でも「ログはありません」を返す (黙って空文字を渡さない)', () => {
    expect(formatDebugLog()).toContain('ログはありません');
  });
});

/**
 * 解析用のコピーに何を載せるか。
 *
 * ⚠️ ログだけ貼られても、どの版・どんな環境で起きたのかが分からないと追えない。
 * ⚠️ 同じ行の繰り返しで上限が埋まると、肝心の操作が流れる。
 */
describe('繰り返しをまとめる', () => {
  const at = 1_000_000;
  const entry = (seq: number, message: string, offset = 0): DebugLogEntry => ({
    seq,
    at: at + offset,
    category: 'cell',
    level: 'info',
    message,
  });

  it('続けて同じ行が出たらまとめる', () => {
    const out = collapseRepeats([
      entry(1, '端なので動かさない'),
      entry(2, '端なので動かさない', 100),
      entry(3, '端なので動かさない', 250),
      entry(4, '次へ'),
    ]);

    expect(out).toHaveLength(2);
    expect(out[0].count).toBe(3);
    expect(out[0].lastAt).toBe(at + 250);
    expect(out[1].count).toBe(1);
  });

  it('間に別の行が挟まればまとめない (順番は崩さない)', () => {
    const out = collapseRepeats([entry(1, 'A'), entry(2, 'B'), entry(3, 'A')]);

    expect(out.map((o) => o.entry.message)).toEqual(['A', 'B', 'A']);
  });

  it('中身が違えばまとめない', () => {
    const a = { ...entry(1, '送り'), detail: 'Win A 1 → 2' };
    const b = { ...entry(2, '送り'), detail: 'Win A 2 → 3' };

    expect(collapseRepeats([a, b])).toHaveLength(2);
  });

  it('空でも落ちない', () => {
    expect(collapseRepeats([])).toEqual([]);
  });
});

describe('カテゴリ別の件数', () => {
  it('多い順に並べ、注意の数も添える', () => {
    const mk = (category: DebugLogCategory, level: 'info' | 'warn' = 'info'): DebugLogEntry => ({
      seq: 1,
      at: 0,
      category,
      level,
      message: 'x',
    });

    const text = tallyByCategory([mk('cell'), mk('cell'), mk('file', 'warn'), mk('view')]);

    expect(text).toContain('cell 2');
    expect(text).toContain('うち注意 1');
  });
});

describe('上限を超えたとき', () => {
  it('捨てた件数を見出しに書く (途中が欠けていると伝えるため)', () => {
    clearDebugLog();
    for (let i = 0; i < 520; i++) logDebug('cell', `行 ${i}`);

    const text = formatDebugLog();

    expect(text).toContain('上限で捨てました');
    expect(text).toContain('20 件');
    clearDebugLog();
  });

  it('捨てていなければ、その断りは書かない', () => {
    clearDebugLog();
    logDebug('cell', 'ひとつ');

    expect(formatDebugLog()).not.toContain('上限で捨てました');
    clearDebugLog();
  });
});
