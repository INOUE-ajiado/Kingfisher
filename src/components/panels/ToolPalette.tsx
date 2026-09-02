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
  Blend,
  Wrench
} from 'lucide-react';

interface ToolItem {
  id: ToolType;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}

export const ToolPalette: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    currentColor,
    backgroundColor,
    setCurrentColor,
    setBackgroundColor,
    swapColors,
    setActiveModal,
  } = usePaintStore();

  const fgInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const hexToRgba = (hex: string) => {
    let clean = hex.replace('#', '');
    if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: 255,
      hex: `#${clean.toUpperCase()}`,
    };
  };

  const handleFgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    usePaintStore.getState().togglePanelVisibility('colorChart');
    fgInputRef.current?.click();
  };

  const handleBgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    usePaintStore.getState().togglePanelVisibility('colorChart');
    bgInputRef.current?.click();
  };
  
  // デフォルト 1列 (40px)、ドラッグで最大2列 (74px)
  const [cols, setCols] = useState<1 | 2>(1);
  const [width, setWidth] = useState<number>(40);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(40);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    // ⚠️ 掴み損ねたときの逃げ道。残すと触れただけで幅が動き出す
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('つまみを掴めませんでした。window 側で離すのを待ちます:', err);
      const release = () => {
        isResizing.current = false;
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    }
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
    } catch (err) {
      // ⚠️ 離すときの失敗は無視してよい (すでにポインタが無い場合に投げる)。
      // 掴むときの失敗は別で受けている
    }

    if (width >= 56) {
      setWidth(74);
      setCols(2);
    } else {
      setWidth(40);
      setCols(1);
    }
  };

  const toggleCols = () => {
    if (cols === 1) {
      setCols(2);
      setWidth(74);
    } else {
      setCols(1);
      setWidth(40);
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

      {/* ツールパレット ヘッダー (見切れゼロ最適化) */}
      <div className="h-6 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between px-1 text-[10px] font-bold text-slate-700 dark:text-slate-300 overflow-hidden">
        {cols === 2 ? (
          <div className="flex items-center gap-1">
            <Wrench className="w-3 h-3 text-blue-500 flex-shrink-0" />
            <span className="text-[11px] font-bold">ツール</span>
          </div>
        ) : (
          <span className="w-full text-center text-[10px] font-bold tracking-tighter text-blue-600 dark:text-blue-400">
            ツール
          </span>
        )}

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
        <div className="relative w-7 h-7" title="前景色/背景色をクリックでカラーパレット表示・色変更">
          {/* 背景色 (BG) */}
          <div
            onClick={handleBgClick}
            style={{ backgroundColor: backgroundColor.hex }}
            className="absolute bottom-0 right-0 w-4 h-4 border border-slate-400 dark:border-slate-600 rounded-sm shadow-sm cursor-pointer hover:scale-110 transition-transform"
            title="クリックで背景色を変更"
          />
          {/* 前景色 (FG) */}
          <div
            onClick={handleFgClick}
            style={{ backgroundColor: currentColor.hex }}
            className="absolute top-0 left-0 w-5 h-5 border-2 border-slate-800 dark:border-slate-100 rounded-sm shadow-md z-10 cursor-pointer hover:scale-110 transition-transform"
            title="クリックで描画色 (前景色) を変更"
          />
        </div>

        {/* 隠しカラーピッカーインプット */}
        <input
          ref={fgInputRef}
          type="color"
          value={currentColor.hex}
          onChange={(e) => setCurrentColor(hexToRgba(e.target.value))}
          className="hidden"
        />
        <input
          ref={bgInputRef}
          type="color"
          value={backgroundColor.hex}
          onChange={(e) => setBackgroundColor(hexToRgba(e.target.value))}
          className="hidden"
        />

        <button
          onClick={swapColors}
          title="前景色 / 背景色の反転 (Swap)"
          className="mt-0.5 p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <ArrowLeftRight className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};
