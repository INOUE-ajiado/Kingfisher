import { useRef, useCallback, useEffect } from 'react';

/**
 * 独立ウィンドウが画面外へ完全に消えてしまわないよう、
 * 最低限ビューポート内に残しておく量 (px)。
 * x はタイトルバーを掴める幅、y はタイトルバーの高さ分。
 */
export const VIEWPORT_KEEP_VISIBLE = { x: 140, y: 28 };

/** 位置をビューポート内へ丸める。右端・下端へ出しすぎて回収不能になるのを防ぐ */
export function clampToViewport(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - VIEWPORT_KEEP_VISIBLE.x);
  const maxY = Math.max(0, window.innerHeight - VIEWPORT_KEEP_VISIBLE.y);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

interface UseFastDraggableOptions {
  initialX?: number;
  initialY?: number;
  enabled?: boolean;
  /** ドラッグが確定した時点で呼ばれる。位置の永続化に使う */
  onCommit?: (x: number, y: number) => void;
}

export function useFastDraggable<T extends HTMLElement = HTMLDivElement>(
  options: UseFastDraggableOptions = {}
) {
  const { initialX = 120, initialY = 80, enabled = true, onCommit } = options;
  const targetRef = useRef<T | null>(null);
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const currentPos = useRef({ x: initialX, y: initialY });

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const applyTransform = useCallback((x: number, y: number) => {
    if (targetRef.current) {
      targetRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, []);

  /**
   * 独立ウィンドウ化した時は位置を適用し、ドッキングへ戻した時は transform を消す。
   *
   * 位置は React の style プロパティではなく element.style へ直接書いている
   * (再描画を挟まないための高速化)。React はこの値を管理していないため、
   * ここで明示的に消さないとドッキングへ戻したパネルがズレたまま残る。
   */
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    if (enabled) {
      const clamped = clampToViewport(currentPos.current.x, currentPos.current.y);
      currentPos.current = clamped;
      el.style.transform = `translate3d(${clamped.x}px, ${clamped.y}px, 0)`;
      el.style.willChange = 'transform';
    } else {
      el.style.transform = '';
      el.style.willChange = '';
    }
  }, [enabled]);

  // ブラウザウィンドウが縮んだ時、画面外に取り残されないよう追い込む
  useEffect(() => {
    if (!enabled) return;

    const handleResize = () => {
      const clamped = clampToViewport(currentPos.current.x, currentPos.current.y);
      if (clamped.x !== currentPos.current.x || clamped.y !== currentPos.current.y) {
        currentPos.current = clamped;
        applyTransform(clamped.x, clamped.y);
        onCommitRef.current?.(clamped.x, clamped.y);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [enabled, applyTransform]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !targetRef.current) return;
      if (e.button !== 0) return;

      e.stopPropagation();
      isDragging.current = true;
      startPos.current = {
        x: e.clientX - currentPos.current.x,
        y: e.clientY - currentPos.current.y,
      };

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {
        // fallback
      }
    },
    [enabled]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current || !targetRef.current || !enabled) return;

      e.stopPropagation();
      e.preventDefault();

      const { x, y } = clampToViewport(e.clientX - startPos.current.x, e.clientY - startPos.current.y);
      currentPos.current = { x, y };

      // ⚠️ React State を解さず、Ref で直に DOM の translate3d を更新（超高速 & 0再描画）
      applyTransform(x, y);
    },
    [enabled, applyTransform]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;

      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}

      onCommitRef.current?.(currentPos.current.x, currentPos.current.y);
    },
    []
  );

  const setPosition = useCallback(
    (x: number, y: number) => {
      const clamped = clampToViewport(x, y);
      currentPos.current = clamped;
      applyTransform(clamped.x, clamped.y);
    },
    [applyTransform]
  );

  return {
    targetRef,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    currentPos,
    setPosition,
  };
}
