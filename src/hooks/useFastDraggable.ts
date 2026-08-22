import { useRef, useCallback, useEffect } from 'react';

interface UseFastDraggableOptions {
  initialX?: number;
  initialY?: number;
  enabled?: boolean;
}

export function useFastDraggable<T extends HTMLElement = HTMLDivElement>(
  options: UseFastDraggableOptions = {}
) {
  const { initialX = 120, initialY = 80, enabled = true } = options;
  const targetRef = useRef<T | null>(null);
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const currentPos = useRef({ x: initialX, y: initialY });

  // 初期位置のセット ＆ will-change 付与
  useEffect(() => {
    if (targetRef.current && enabled) {
      targetRef.current.style.transform = `translate3d(${currentPos.current.x}px, ${currentPos.current.y}px, 0)`;
      targetRef.current.style.willChange = 'transform';
    }
  }, [enabled]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !targetRef.current) return;
      if (e.button !== 0) return;

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

      const x = e.clientX - startPos.current.x;
      const y = e.clientY - startPos.current.y;
      currentPos.current = { x, y };

      // ⚠️ React State を解さず、Ref で直に DOM の translate3d を更新（超高速 & 0再描画）
      targetRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    },
    [enabled]
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
    },
    []
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
  };
}
