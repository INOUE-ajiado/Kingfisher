import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearDebugLog,
  formatDebugLog,
  getDebugLog,
  logDebug,
  subscribeDebugLog,
} from './debugLog';

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
