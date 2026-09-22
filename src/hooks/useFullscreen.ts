import { useCallback, useEffect, useState } from 'react';

/**
 * 要素を全画面にする / 戻す。
 *
 * ⚠️ 面ごとに書き写さないこと。以前はロール窓・ラッシュ窓・一般公開の視聴画面で
 * 別々に持っており、「Esc で戻したときに状態が残る」といった直しが
 * 片方にしか入らない形になっていた。
 * ⚠️ 中の要素が全画面になっている場合も「この面が全画面」と見なすこと。
 * contains を見ないと、入れ子の要素から全画面にしたときに判定が外れる。
 */
export function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const el = ref.current;
      const active = document.fullscreenElement;
      setIsFullscreen(Boolean(active && (active === el || el?.contains(active))));
    };
    document.addEventListener('fullscreenchange', onChange);
    // 開いた時点で既に全画面のことがある (別の面から切り替えた直後)
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  const toggleFullscreen = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().catch((err: unknown) => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      void document.exitFullscreen?.().catch((err: unknown) => {
        console.error('Failed to exit fullscreen:', err);
      });
    }
  }, [ref]);

  return { isFullscreen, toggleFullscreen };
}
