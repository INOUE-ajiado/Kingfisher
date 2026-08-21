import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { SkipForward } from 'lucide-react';

export const ToolOptions: React.FC = () => {
  const {
    activeTool,
    toolOptions,
    setGapCloseLevel,
    setEnableIncludeTrace,
    setRetainTraceLine,
    toggleTraceColor,
    setBrushSize,
    setExpandContract,
    setContiguous,
    setReferenceLayer,
    nextCell,
  } = usePaintStore();

  return (
    <div className="h-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex items-center px-3 text-xs shadow-sm select-none gap-3 overflow-x-auto">
      {/* 隙間閉じ */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <label className="text-slate-700 dark:text-slate-300 font-medium">隙間閉じ:</label>
        <input
          type="range"
          min="0"
          max="20"
          value={toolOptions.gapCloseLevel}
          onChange={(e) => setGapCloseLevel(Number(e.target.value))}
          className="w-16 accent-blue-600 cursor-pointer"
        />
        <span className="w-6 text-slate-800 dark:text-slate-200 font-mono text-[11px]">{toolOptions.gapCloseLevel}px</span>
      </div>

      <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 flex-shrink-0" />

      {/* 色トレス線 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <input
          type="checkbox"
          id="trace"
          checked={toolOptions.enableIncludeTrace}
          onChange={(e) => setEnableIncludeTrace(e.target.checked)}
          className="rounded accent-blue-600 cursor-pointer"
        />
        <label htmlFor="trace" className="text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
          色トレス線を含む
        </label>
        <div className="flex gap-1">
          <div
            onClick={() => toggleTraceColor('red')}
            title="Red Trace"
            className={`w-3.5 h-3.5 rounded-sm bg-red-500 cursor-pointer border ${
              toolOptions.traceColors.red ? 'border-2 border-slate-900 dark:border-slate-100 scale-110' : 'border-slate-300 opacity-40'
            }`}
          />
          <div
            onClick={() => toggleTraceColor('blue')}
            title="Blue Trace"
            className={`w-3.5 h-3.5 rounded-sm bg-blue-500 cursor-pointer border ${
              toolOptions.traceColors.blue ? 'border-2 border-slate-900 dark:border-slate-100 scale-110' : 'border-slate-300 opacity-40'
            }`}
          />
          <div
            onClick={() => toggleTraceColor('green')}
            title="Green Trace"
            className={`w-3.5 h-3.5 rounded-sm bg-emerald-500 cursor-pointer border ${
              toolOptions.traceColors.green ? 'border-2 border-slate-900 dark:border-slate-100 scale-110' : 'border-slate-300 opacity-40'
            }`}
          />
        </div>
      </div>

      {/* トレス線を残す */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          type="checkbox"
          id="retainTrace"
          checked={toolOptions.retainTraceLine}
          onChange={(e) => setRetainTraceLine(e.target.checked)}
          className="rounded accent-blue-600 cursor-pointer"
        />
        <label htmlFor="retainTrace" className="text-slate-700 dark:text-slate-300 cursor-pointer text-[11px]">
          線を残す
        </label>
      </div>

      <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 flex-shrink-0" />

      {/* 領域拡張 / 縮小 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <label className="text-slate-700 dark:text-slate-300 font-medium">領域拡張:</label>
        <input
          type="range"
          min="-10"
          max="10"
          value={toolOptions.expandContract}
          onChange={(e) => setExpandContract(Number(e.target.value))}
          className="w-16 accent-blue-600 cursor-pointer"
        />
        <span className="w-7 text-slate-800 dark:text-slate-200 font-mono text-[11px]">{toolOptions.expandContract}px</span>
      </div>

      <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 flex-shrink-0" />

      {/* 隣接ピクセルのみ */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <input
          type="checkbox"
          id="contiguous"
          checked={toolOptions.contiguous}
          onChange={(e) => setContiguous(e.target.checked)}
          className="rounded accent-blue-600 cursor-pointer"
        />
        <label htmlFor="contiguous" className="text-slate-700 dark:text-slate-300 cursor-pointer">
          隣接のみ
        </label>
      </div>

      {/* ブラシ / 鉛筆サイズ */}
      {(activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') && (
        <>
          <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 flex-shrink-0" />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <label className="text-slate-700 dark:text-slate-300 font-medium">サイズ:</label>
            <input
              type="range"
              min="1"
              max="100"
              value={toolOptions.brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-16 accent-blue-600 cursor-pointer"
            />
            <span className="w-7 text-slate-800 dark:text-slate-200 font-mono text-[11px]">{toolOptions.brushSize}px</span>
          </div>
        </>
      )}

      <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 flex-shrink-0" />

      {/* 参照先 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <label className="text-slate-700 dark:text-slate-300 font-medium">参照先:</label>
        <select
          value={toolOptions.referenceLayer}
          onChange={(e) => setReferenceLayer(e.target.value as any)}
          className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded text-[11px] px-1 py-0.5"
        >
          <option value="current">編集レイヤーのみ</option>
          <option value="all">すべてのレイヤー</option>
          <option value="reference">参照レイヤー</option>
        </select>
      </div>

      <button
        onClick={nextCell}
        className="ml-auto bg-orange-500 hover:bg-orange-600 text-white font-bold py-1 px-3 rounded text-[11px] flex items-center gap-1.5 transition-colors shadow-sm flex-shrink-0"
      >
        <span>Next Cell (PgDn)</span>
        <SkipForward className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
