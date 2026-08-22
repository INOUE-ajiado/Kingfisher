import React, { useState, useRef } from 'react';
import { usePaintStore, ToolType } from '../../store/usePaintStore';
import { 
  Square,
  Lasso, 
  Wand2,
  Pencil,
  Paintbrush, 
  PaintBucket, 
  CircleDot, 
  Eraser, 
  Pipette, 
  Hand, 
  ZoomIn,
  Sparkles,
  ArrowLeftRight,
  RefreshCw,
  Blend
} from 'lucide-react';

interface ToolItem {
  id: ToolType;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}

export const ToolPalette: React.FC = () => {
  const { activeTool, setActiveTool, currentColor, backgroundColor, swapColors, setActiveModal } = usePaintStore();
  
  // デフォルト 1列 (36px)、ドラッグで最大2列 (68px)
  const [cols, setCols] = useState<1 | 2>(1);
  const [width, setWidth] = useState<number>(36);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(36);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isResizing.current) return;
    const deltaX = e.clientX - startX.current;
    const newWidth = Math.min(72, Math.max(36, startWidth.current + deltaX));
    setWidth(newWidth);
    if (newWidth >= 54) {
      setCols(2);
    } else {
      setCols(1);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isResizing.current) return;
    isResizing.current = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}

    if (width >= 52) {
      setWidth(68);
      setCols(2);
    } else {
      setWidth(36);
      setCols(1);
    }
  };

  const toggleCols = () => {
    if (cols === 1) {
      setCols(2);
      setWidth(68);
    } else {
      setCols(1);
      setWidth(36);
    }
  };

  const tools: ToolItem[] = [
    { id: 'pointer', label: '矩形選択', icon: <Square className="w-3.5 h-3.5" />, shortcut: 'M' },
    { id: 'lasso', label: '投げ縄選択', icon: <Lasso className="w-3.5 h-3.5" />, shortcut: 'L' },
    { id: 'eyedropper', label: 'マジックワンド', icon: <Wand2 className="w-3.5 h-3.5" />, shortcut: 'W' },
    { id: 'pencil', label: '鉛筆 (ドット2値線)', icon: <Pencil className="w-3.5 h-3.5" />, shortcut: 'P' },
    { id: 'brush', label: 'ブラシ (アンチエイリアス)', icon: <Paintbrush className="w-3.5 h-3.5" />, shortcut: 'B' },
    { id: 'fill', label: '塗りつぶし (バケツ)', icon: <PaintBucket className="w-3.5 h-3.5" />, shortcut: 'F' },
    { id: 'gradient', label: 'グラデーション塗り', icon: <Blend className="w-3.5 h-3.5 text-blue-500" />, shortcut: 'G' },
    { id: 'closedFill', label: '閉領域フィル', icon: <CircleDot className="w-3.5 h-3.5" />, shortcut: 'U' },
    { id: 'eraser', label: '消しゴム', icon: <Eraser className="w-3.5 h-3.5" />, shortcut: 'E' },
    { id: 'noiseEraser', label: '手動ワンクリックゴミ取り', icon: <Sparkles className="w-3.5 h-3.5 text-amber-500" />, shortcut: 'N' },
    { id: 'eyedropper', label: 'スポイト', icon: <Pipette className="w-3.5 h-3.5" />, shortcut: 'I' },
    { id: 'pan', label: '手のひら (パン)', icon: <Hand className="w-3.5 h-3.5" />, shortcut: 'H' },
    { id: 'zoom', label: 'ズーム', icon: <ZoomIn className="w-3.5 h-3.5" />, shortcut: 'Z' },
  ];

  return (
    <div
      style={{ width: `${width}px` }}
      className="bg-white dark:bg-slate-900 border-r border-slate-300 dark:border-slate-800 flex flex-col select-none relative transition-all duration-75 group flex-shrink-0"
    >
      {/* 右端ドラッグリサイズハンドルバー (1列 ↔ 2列伸縮) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={toggleCols}
        title="右へドラッグで2列化 / ダブルクリックで1列↔2列切替"
        className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-600 z-30 transition-colors touch-none"
      />

      {/* ツールパレット ヘッダー */}
      <div className="h-6 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between px-1 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
        <span className="truncate">{cols === 2 ? 'ツール' : '具'}</span>
        {cols === 2 && (
          <button
            onClick={() => setActiveModal('replaceColor')}
            title="全セル一括色置換 (Color Replace)"
            className="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ツールアイコンリスト (1列 / 2列 自動レスポンシブ) */}
      <div className={`p-1 grid ${cols === 2 ? 'grid-cols-2 gap-1' : 'grid-cols-1 gap-1 items-center justify-items-center'}`}>
        {tools.map((t, idx) => {
          const isActive = activeTool === t.id;
          return (
            <button
              key={idx}
              onClick={() => setActiveTool(t.id)}
              title={`${t.label} (${t.shortcut})`}
              className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                isActive
                  ? 'bg-blue-100 dark:bg-blue-900/80 border border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-300 font-bold shadow-inner'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
              }`}
            >
              {t.icon}
            </button>
          );
        })}
      </div>

      {/* クラシック 前景色 / 背景色 重ね合わせカラーピッカー */}
      <div className="p-1 border-t border-slate-200 dark:border-slate-800 flex flex-col items-center">
        <div className="relative w-7 h-7 cursor-pointer" title="クリックで前景色と背景色を入れ替え">
          {/* 背景色 (BG) */}
          <div
            onClick={swapColors}
            style={{ backgroundColor: backgroundColor.hex }}
            className="absolute bottom-0 right-0 w-4 h-4 border border-slate-400 dark:border-slate-600 rounded-sm shadow-sm"
          />
          {/* 前景色 (FG) */}
          <div
            onClick={swapColors}
            style={{ backgroundColor: currentColor.hex }}
            className="absolute top-0 left-0 w-5 h-5 border-2 border-slate-800 dark:border-slate-100 rounded-sm shadow-md z-10"
          />
        </div>
        <button
          onClick={swapColors}
          title="前景色 / 背景色の反転"
          className="mt-0.5 p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <ArrowLeftRight className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};
