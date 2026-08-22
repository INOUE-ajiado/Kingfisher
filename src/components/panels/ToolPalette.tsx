import React from 'react';
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
    <div className="w-16 bg-white dark:bg-slate-900 border-r border-slate-300 dark:border-slate-800 flex flex-col select-none">
      <div className="h-6 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between px-2 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
        <span>ツール</span>
        <button
          onClick={() => setActiveModal('replaceColor')}
          title="全セル一括色置換 (Color Replace)"
          className="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* 2列グリッド */}
      <div className="p-1 grid grid-cols-2 gap-1">
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

      {/* クラシック 前景色 / 背景色 重ね合わせカラーピッカー (Color Swatches) */}
      <div className="p-2 border-t border-slate-200 dark:border-slate-800 flex flex-col items-center">
        <div className="relative w-9 h-9 cursor-pointer" title="クリックで前景色と背景色を入れ替え">
          {/* 背景色 (BG) */}
          <div
            onClick={swapColors}
            style={{ backgroundColor: backgroundColor.hex }}
            className="absolute bottom-0 right-0 w-5 h-5 border border-slate-400 dark:border-slate-600 rounded-sm shadow-sm"
          />
          {/* 前景色 (FG) */}
          <div
            onClick={swapColors}
            style={{ backgroundColor: currentColor.hex }}
            className="absolute top-0 left-0 w-6 h-6 border-2 border-slate-800 dark:border-slate-100 rounded-sm shadow-md z-10"
          />
        </div>
        <button
          onClick={swapColors}
          title="前景色 / 背景色の反転"
          className="mt-1 p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <ArrowLeftRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
