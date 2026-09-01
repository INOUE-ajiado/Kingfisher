/**
 * 右クリックメニューを「外を押したから閉じる」かどうかの判定。
 *
 * ⚠️ ここを間違えると、項目を押した瞬間にメニューが外れ、click が届かず
 * どの項目も実行できなくなる (2026-09-02 の報告で実際に起きた)。
 * 判定だけを切り出してあるのは、DOM 無しで確かめられるようにするため。
 */

/** contains() だけ使えれば良い (テストで差し替えられるように) */
export interface ContainsNode {
  contains(node: any): boolean;
}

/**
 * 押された先がメニューの中か。
 *
 * ⚠️ メニューがまだ描かれていない (ref が null) 場合は「外」とみなす。
 * 開いた直後に押された場合も、閉じる方が安全 (押せないメニューが残らない)。
 * ⚠️ window や document のような Node でない相手は「外」とみなす。
 */
export function isPointerInsideMenu(menu: ContainsNode | null | undefined, target: unknown): boolean {
  if (!menu) return false;
  if (!target || typeof target !== 'object') return false;
  if (typeof (target as { nodeType?: unknown }).nodeType !== 'number') return false;
  return menu.contains(target);
}
