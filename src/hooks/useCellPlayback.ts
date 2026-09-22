import { useEffect } from 'react';
import { usePaintStore } from '../store/usePaintStore';
import { PLAYBACK_SOURCE } from '../engine/debugLog';

/**
 * セルのアニメーション再生 (コマを順に送る)。
 *
 * ⚠️ fps と 1 コマの長さは依存に入れること。setInterval の間隔は作った時点でしか
 * 決まらないので、外すと再生中にスライダーを動かしても次に止めるまで効かない。
 */
export function useCellPlayback(): void {
  const isPlaying = usePaintStore((s) => s.isPlaying);
  const fps = usePaintStore((s) => s.fps);
  const frameHold = usePaintStore((s) => s.toolOptions.frameHold);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const { currentFileIndex, unifiedFileList, setCurrentFileIndex } = usePaintStore.getState();

      // ⚠️ 空リストのまま剰余を取ると NaN になる。currentFileIndex が NaN になると
      // NaN === NaN が false のため毎回 set が通り、履歴を消し続けたまま復帰できない。
      // 再生ボタンはフォルダを開いていなくても押せるので、ここで必ず弾く。
      const total = unifiedFileList.length;
      if (total === 0) return;

      const current = Number.isInteger(currentFileIndex) ? currentFileIndex : -1;
      // ⚠️ 毎コマ走るので DEBUG ログには残さない (PLAYBACK_SOURCE)
      setCurrentFileIndex((current + 1) % total, PLAYBACK_SOURCE);
    }, (1000 / Math.max(1, fps)) * frameHold);

    return () => clearInterval(interval);
  }, [isPlaying, fps, frameHold]);
}
