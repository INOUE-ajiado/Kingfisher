import React from 'react';
import { createPortal } from 'react-dom';

interface FloatingPortalProps {
  /** true の間だけ document.body 直下へ描画する */
  enabled: boolean;
  children: React.ReactNode;
}

/**
 * 独立ウィンドウを document.body 直下へ逃がすためのポータル。
 *
 * position:fixed の要素でも、祖先にスクロールコンテナ (overflow: auto / scroll) があると
 * ブラウザはそのスクロール領域の一部として扱う。すると transform を変えるたびに
 * 合成レイヤーだけでは処理しきれず再描画が発生し、ドラッグがカーソルに遅れて追従する。
 *
 * カラーチャートは右サイドパネル (overflow-y-auto) の中に置かれているためこれに該当する。
 * Win A / Win B / 参照ウィンドウはスクロールしない領域にあるので影響を受けない。
 */
export const FloatingPortal: React.FC<FloatingPortalProps> = ({ enabled, children }) => {
  if (!enabled) return <>{children}</>;
  return createPortal(children, document.body);
};
