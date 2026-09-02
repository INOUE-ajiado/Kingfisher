/**
 * 「キャンバスを描き直せ」の合図。
 *
 * ⚠️ ストア (zustand) の中に置かないこと。ブラシを引いている間は
 * マウスが動くたびに合図を出すので、ストアへ入れると
 * ストア全体を購読しているパネル (ファイルツリー・メニュー・ツールオプション …)
 * が毎フレーム描き直される。線を 1 本引くだけで全画面が再描画されていた
 * (2026-09-03 の監査)。
 * ⚠️ DEBUG ログ (engine/debugLog.ts) と同じ作りにしてある。
 * 購読するのはキャンバスだけ。
 */

let tick = 0;
const listeners = new Set<() => void>();

/** キャンバスを描き直させる */
export function triggerRenderSignal(): void {
  tick += 1;
  listeners.forEach((fn) => fn());
}

export function getRenderSignal(): number {
  return tick;
}

export function subscribeRenderSignal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** テスト用。数え直す */
export function resetRenderSignalForTest(): void {
  tick = 0;
  listeners.clear();
}
