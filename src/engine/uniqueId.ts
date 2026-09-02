/**
 * 二度と重複しない ID を作る。
 *
 * ⚠️ Date.now() を ID にしないこと。ループで足すと同じミリ秒に何度も呼ばれ、
 * 同じ ID になる。ID で消す・書き換える作り (filter / map) なので、
 * 衝突すると「1 つ消したつもりが 2 つ消える」ことになる。
 * 実際に線画分離のレイヤーで起き、ライトテーブルとパレットにも同じ形が残っていた
 * (2026-09-03 の監査で再現)。
 */

let counter = 0;

/** 「light-3-k2p9x」のような、読める接頭辞つきの ID */
export function nextId(prefix: string): string {
  counter += 1;
  const salt = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${counter}-${salt}`;
}

/** テスト用。連番を巻き戻す */
export function resetIdCounterForTest(): void {
  counter = 0;
}
