import React, { useRef } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { DebugLogPanel } from './DebugLogPanel';

/**
 * 操作ログの引き出し。画面の下からせり上がる。
 *
 * ⚠️ 右サイドバーへ入れないこと。1 行が長いので狭いと折り返しだらけになり、
 * 読むのに向かない (2026-09-04 のユーザー指定)。
 * ⚠️ 閉じているときも要素は残し、下へずらして隠すこと。付け外しにすると
 * 開くたびに一覧を組み直すことになり、せり上がる動きも出せない。
 * ⚠️ 閉じている間はクリックを通すこと (pointer-events-none)。
 * 見えない板が画面の下端に残っていると、下のボタンが押せなくなる。
 */
export const DebugLogDrawer: React.FC = () => {
  const isOpen = usePaintStore((s) => s.panelVisibility.debugLog);
  const height = usePaintStore((s) => s.debugLogHeight);
  const setHeight = usePaintStore((s) => s.setDebugLogHeight);

  /** つまみを掴んだ時点の位置と高さ */
  const dragRef = useRef<{ y: number; height: number } | null>(null);

  const handleGripDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { y: e.clientY, height };

    /**
     * ⚠️ 掴み損ねたときの逃げ道を用意すること。setPointerCapture が失敗すると
     * 離した合図がここへ来ず、掴んだままの状態が残る。
     */
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('つまみを掴めませんでした。window 側で離すのを待ちます:', err);
      const release = () => {
        dragRef.current = null;
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    }
  };

  const handleGripMove = (e: React.PointerEvent) => {
    const start = dragRef.current;
    if (!start) return;
    // 上へドラッグすると高くなる
    setHeight(start.height + (start.y - e.clientY));
  };

  const handleGripUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (err) {
      // 離すときの失敗は無視してよい (すでにポインタが無い場合に投げる)
    }
  };

  return (
    <div
      style={{ height: `${height}px`, transform: isOpen ? 'translateY(0)' : 'translateY(100%)' }}
      className={`fixed left-0 right-0 bottom-0 z-40 flex flex-col bg-white dark:bg-slate-900 border-t-2 border-rose-500 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out ${
        isOpen ? '' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      {/* 高さを変えるつまみ */}
      <div
        onPointerDown={handleGripDown}
        onPointerMove={handleGripMove}
        onPointerUp={handleGripUp}
        onPointerCancel={handleGripUp}
        title="ドラッグで高さを変える"
        className="h-2 flex-shrink-0 cursor-ns-resize touch-none flex items-center justify-center group"
      >
        <div className="w-16 h-1 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-rose-400 transition-colors" />
      </div>

      <div className="flex-1 min-h-0">
        <DebugLogPanel />
      </div>
    </div>
  );
};
