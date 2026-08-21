import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { Play, Pause, Palette, Clapperboard } from 'lucide-react';

export const LightTable: React.FC = () => {
  const {
    lightTable,
    setLightTableEnabled,
    setLightTableOpacity,
    setLightTableColorMode,
    fileList,
    currentFileIndex,
    isPlaying,
    setIsPlaying,
    fps,
    setFps,
    toolOptions,
    setFrameHold,
  } = usePaintStore();

  const prevFrameName = currentFileIndex > 0 ? fileList[currentFileIndex - 1] : null;
  const currentFrameName = fileList[currentFileIndex] || '0001';
  const nextFrameName = currentFileIndex < fileList.length - 1 ? fileList[currentFileIndex + 1] : null;

  return (
    <div className="h-14 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex items-center px-4 text-xs shadow-sm select-none">
      {/* Light Table Controls */}
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-700 dark:text-slate-300">Light Table:</span>
        <input
          type="checkbox"
          checked={lightTable.enabled}
          onChange={(e) => setLightTableEnabled(e.target.checked)}
          className="rounded accent-blue-600 cursor-pointer"
        />

        <div className="flex items-center gap-1.5 ml-1">
          {prevFrameName ? (
            <div className="w-[50px] h-7 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-medium rounded flex items-center justify-center text-[10px]">
              {prevFrameName.replace('.tga', '')}
            </div>
          ) : (
            <div className="w-[50px] h-7 border border-dashed border-slate-200 dark:border-slate-700 rounded flex items-center justify-center text-[10px] text-slate-400 dark:text-slate-600">
              -
            </div>
          )}

          <div className="w-[55px] h-7 border border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 font-bold rounded flex items-center justify-center text-[11px]">
            {currentFrameName.replace('.tga', '')}
          </div>

          {nextFrameName ? (
            <div className="w-[50px] h-7 border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-medium rounded flex items-center justify-center text-[10px]">
              {nextFrameName.replace('.tga', '')}
            </div>
          ) : (
            <div className="w-[50px] h-7 border border-dashed border-slate-200 dark:border-slate-700 rounded flex items-center justify-center text-[10px] text-slate-400 dark:text-slate-600">
              -
            </div>
          )}
        </div>

        <button
          onClick={() => setLightTableColorMode(lightTable.colorMode === 'tinted' ? 'default' : 'tinted')}
          title="前=赤 / 後=青 の色分け切り替え"
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${
            lightTable.colorMode === 'tinted'
              ? 'bg-red-50 dark:bg-red-900/40 border-red-500 text-red-600 dark:text-red-300'
              : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
          }`}
        >
          <Palette className="w-3 h-3" />
          <span>{lightTable.colorMode === 'tinted' ? '前赤/後青' : '通常色'}</span>
        </button>

        <div className="flex items-center gap-2 ml-2">
          <span className="text-slate-600 dark:text-slate-400">Opacity:</span>
          <input
            type="range"
            min="0"
            max="100"
            value={lightTable.opacity}
            onChange={(e) => setLightTableOpacity(Number(e.target.value))}
            className="w-16 accent-blue-600 cursor-pointer"
          />
          <span className="w-8 text-slate-700 dark:text-slate-300 font-mono text-[11px] font-semibold">{lightTable.opacity}%</span>
        </div>
      </div>

      {/* Animation Playback Controls & コマ打ち選択 */}
      <div className="ml-auto flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-1 text-[11px]">
          <Clapperboard className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <select
            value={toolOptions.frameHold}
            onChange={(e) => setFrameHold(Number(e.target.value) as any)}
            className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded px-1.5 py-0.5 text-[11px] font-medium cursor-pointer"
          >
            <option value={1}>1コマ打ち (24fps)</option>
            <option value={2}>2コマ打ち (12fps)</option>
            <option value={3}>3コマ打ち (8fps)</option>
          </select>
        </div>

        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`flex items-center gap-1 px-3 py-1 rounded font-semibold text-[11px] transition-colors ${
            isPlaying
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          }`}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>

        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
          <span>{fps} FPS</span>
          <input
            type="range"
            min="1"
            max="24"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            className="w-14 accent-emerald-600 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
