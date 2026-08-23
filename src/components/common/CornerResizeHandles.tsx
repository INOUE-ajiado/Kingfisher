import React from 'react';
import { CornerDirection } from '../../hooks/useResizableWindow';

interface CornerResizeHandlesProps {
  getResizeHandler: (dir: CornerDirection) => (e: React.PointerEvent) => void;
  className?: string;
}

export const CornerResizeHandles: React.FC<CornerResizeHandlesProps> = ({ getResizeHandler, className = '' }) => {
  const corners: { dir: CornerDirection; cursor: string; posClass: string; borderClass: string }[] = [
    { dir: 'nw', cursor: 'cursor-nwse-resize', posClass: 'top-0 left-0', borderClass: 'border-t-2 border-l-2 rounded-tl' },
    { dir: 'ne', cursor: 'cursor-nesw-resize', posClass: 'top-0 right-0', borderClass: 'border-t-2 border-r-2 rounded-tr' },
    { dir: 'sw', cursor: 'cursor-nesw-resize', posClass: 'bottom-0 left-0', borderClass: 'border-b-2 border-l-2 rounded-bl' },
    { dir: 'se', cursor: 'cursor-nwse-resize', posClass: 'bottom-0 right-0', borderClass: 'border-b-2 border-r-2 rounded-br' },
  ];

  return (
    <>
      {corners.map(({ dir, cursor, posClass, borderClass }) => (
        <div
          key={dir}
          onPointerDown={getResizeHandler(dir)}
          className={`absolute w-3.5 h-3.5 z-50 ${posClass} ${cursor} flex items-center justify-center group ${className}`}
          title={`ドラッグで全方向リサイズ (${dir.toUpperCase()})`}
        >
          <div
            className={`w-2 h-2 ${borderClass} border-blue-500/80 group-hover:border-amber-400 group-hover:scale-125 transition-all shadow-xs`}
          />
        </div>
      ))}
    </>
  );
};
