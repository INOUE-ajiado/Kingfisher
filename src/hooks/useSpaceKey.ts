import { useEffect, useState } from 'react';

/**
 * Space を押している間だけ true。押しっぱなしで一時的にパン移動にするためのもの。
 *
 * ⚠️ 入力欄の中では拾わないこと (文字として入る)。
 * ⚠️ ウィンドウからフォーカスが外れている間に離すと keyup が届かない。
 * blur でも必ず落とすこと。落とさないと「Space 押しっぱなし」と誤認して、
 * 以降の左クリックがすべてパンになり続ける。
 */
export function useSpaceKey(): boolean {
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      setIsSpacePressed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };
    const clear = () => setIsSpacePressed(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return isSpacePressed;
}
