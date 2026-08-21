import React, { useState } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { X, Sliders, Sparkles, Wand2 } from 'lucide-react';
import { binarizeImage, removeNoise } from '../../engine/paintAlgorithm';

export const PreferencesModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    currentImage,
    triggerRender,
    saveUndoState,
    smoothLineartGlobal,
  } = usePaintStore();

  const [threshold, setThreshold] = useState(180);
  const [maxNoiseSize, setMaxNoiseSize] = useState(5);

  if (activeModal !== 'preferences') return null;

  const handleBinarize = () => {
    if (currentImage) {
      saveUndoState('線画の二値化');
      binarizeImage(currentImage.data, threshold);
      triggerRender();
      alert(`閾値 ${threshold} で二値化を実行しました。`);
    }
  };

  const handleRemoveNoise = () => {
    if (currentImage) {
      saveUndoState('ゴミ取り');
      removeNoise(currentImage.data, currentImage.width, currentImage.height, maxNoiseSize);
      triggerRender();
      alert(`最大サイズ ${maxNoiseSize}px 以下のゴミを取り除きました。`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-96 p-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
            <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>環境設定 & 画像補正</span>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-4 space-y-4 text-xs">
          {/* 線画二値化 */}
          <div className="space-y-2 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-blue-500" />
              <span>線画の二値化 (Binarize)</span>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-slate-600 dark:text-slate-400">閾値 (Threshold):</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="50"
                  max="240"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-24 accent-blue-600 cursor-pointer"
                />
                <span className="w-8 font-mono">{threshold}</span>
              </div>
            </div>
            <button
              onClick={handleBinarize}
              className="w-full mt-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 rounded text-[11px] transition-colors"
            >
              二値化を実行
            </button>
          </div>

          {/* 自動ゴミ取り */}
          <div className="space-y-2 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>自動ゴミ取り (Noise Removal)</span>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-slate-600 dark:text-slate-400">最大ゴミサイズ (px):</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={maxNoiseSize}
                  onChange={(e) => setMaxNoiseSize(Number(e.target.value))}
                  className="w-24 accent-amber-600 cursor-pointer"
                />
                <span className="w-8 font-mono">{maxNoiseSize}px</span>
              </div>
            </div>
            <button
              onClick={handleRemoveNoise}
              className="w-full mt-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-1 rounded text-[11px] transition-colors"
            >
              一括ゴミ取りを実行
            </button>
          </div>

          {/* 主線平滑化 (Line Smoothing) */}
          <div className="space-y-2 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>主線平滑化 (Line Smoothing)</span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              線画のジャギー（ギザギザ）を滑らかに補正します。
            </p>
            <button
              onClick={() => {
                smoothLineartGlobal();
                alert('主線平滑化フィルタを適用しました。');
              }}
              className="w-full mt-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1 rounded text-[11px] transition-colors"
            >
              主線平滑化を実行
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setActiveModal(null)}
            className="px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
