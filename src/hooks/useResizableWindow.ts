import { useRef, useCallback } from 'react';

export type CornerDirection = 'nw' | 'ne' | 'sw' | 'se';

interface UseResizableWindowOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  enabled?: boolean;
}

export function useResizableWindow<T extends HTMLElement = HTMLDivElement>(
  targetRef: React.RefObject<T | null>,
  currentPosRef: React.RefObject<{ x: number; y: number }>,
  setPosition: (x: number, y: number) => void,
  options: UseResizableWindowOptions = {}
) {
  const {
    minWidth = 240,
    minHeight = 180,
    maxWidth = window.innerWidth * 0.9,
    maxHeight = window.innerHeight * 0.9,
    enabled = true,
  } = options;

  const isResizing = useRef(false);
  const startState = useRef({
    mouseX: 0,
    mouseY: 0,
    posX: 0,
    posY: 0,
    width: 0,
    height: 0,
    direction: 'se' as CornerDirection,
  });

  const getResizeHandler = useCallback(
    (direction: CornerDirection) => (e: React.PointerEvent) => {
      if (!enabled || !targetRef.current) return;
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      isResizing.current = true;

      const rect = targetRef.current.getBoundingClientRect();
      const currentPos = currentPosRef.current || { x: rect.left, y: rect.top };

      startState.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: currentPos.x,
        posY: currentPos.y,
        width: rect.width,
        height: rect.height,
        direction,
      };

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {}

      const handlePointerMove = (moveEvt: PointerEvent) => {
        if (!isResizing.current || !targetRef.current) return;
        moveEvt.preventDefault();

        const deltaX = moveEvt.clientX - startState.current.mouseX;
        const deltaY = moveEvt.clientY - startState.current.mouseY;

        let newW = startState.current.width;
        let newH = startState.current.height;
        let newX = startState.current.posX;
        let newY = startState.current.posY;

        const dir = startState.current.direction;

        // 幅・高さ・位置の動的幾何計算
        if (dir.includes('e')) {
          newW = Math.min(maxWidth, Math.max(minWidth, startState.current.width + deltaX));
        } else if (dir.includes('w')) {
          const calcW = Math.min(maxWidth, Math.max(minWidth, startState.current.width - deltaX));
          newX = startState.current.posX + (startState.current.width - calcW);
          newW = calcW;
        }

        if (dir.includes('s')) {
          newH = Math.min(maxHeight, Math.max(minHeight, startState.current.height + deltaY));
        } else if (dir.includes('n')) {
          const calcH = Math.min(maxHeight, Math.max(minHeight, startState.current.height - deltaY));
          newY = startState.current.posY + (startState.current.height - calcH);
          newH = calcH;
        }

        // Direct DOM 高速更新
        targetRef.current.style.width = `${newW}px`;
        targetRef.current.style.height = `${newH}px`;
        setPosition(newX, newY);
      };

      const handlePointerUp = (upEvt: PointerEvent) => {
        if (!isResizing.current) return;
        isResizing.current = false;

        try {
          if (e.currentTarget.hasPointerCapture(upEvt.pointerId)) {
            e.currentTarget.releasePointerCapture(upEvt.pointerId);
          }
        } catch (err) {}

        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp, { capture: true });
      window.addEventListener('pointercancel', handlePointerUp, { capture: true });
    },
    [enabled, targetRef, currentPosRef, setPosition, minWidth, minHeight, maxWidth, maxHeight]
  );

  return { getResizeHandler };
}
