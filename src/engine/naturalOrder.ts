/**
 * ファイル名を「人が見て自然な連番順」で並べる。
 *
 * ⚠️ ファイル一覧に素の Array.prototype.sort() を使わないこと。
 * 辞書順になるため、ゼロ埋めが揃っていない連番が
 *   a1, a10, a11, a2, a3, a4, a5
 * のように並ぶ。撮影・仕上げのデータはゼロ埋めが揃っていないことが普通にあり、
 * これが「1 が最後に来る」「順番が飛ぶ」という見え方になる。
 *
 * 連番表 (unifiedFileList) はフレーム番号で数値順に並べているので、
 * ここを揃えておかないとツリーと連番表で並びが食い違う。
 */

/**
 * numeric: true の照合器。数字の並びを数値として比べてくれる。
 *
 * ⚠️ 使い回すこと。localeCompare を都度呼ぶと比較のたびに照合器が作られ、
 * 数千コマのカットで目に見えて遅くなる。
 */
const collator = new Intl.Collator(undefined, { numeric: true });

/** 自然順の比較。全順序になるよう、照合が同値でも一意な順序を返す */
export function compareNatural(a: string, b: string): number {
  const result = collator.compare(a, b);
  if (result !== 0) return result;
  // 照合器が同値と見なす組み合わせ (全角と半角など) でも並びを確定させる
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ファイル一覧を自然順に並べた新しい配列を返す */
export function sortNatural(paths: Iterable<string>): string[] {
  return Array.from(paths).sort(compareNatural);
}
