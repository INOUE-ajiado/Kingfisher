import React, { useState } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { X, RefreshCw } from 'lucide-react';

export const ReplaceColorModal: React.FC = () => {
  const { activeModal, setActiveModal, currentColor, replaceColorGlobal } = usePaintStore();
  const [targetHex, setTargetHex] = useState('#FFFFFF');
  const [newHex, setNewHex] = useState(currentColor.hex);

  if (activeModal !== 'replaceColor') return null;

  const handleExecute = () => {
    replaceColorGlobal(targetHex, newHex);
    setActiveModal(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-96 p-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
            <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>全セル一括色置換 (Global Color Replace)</span>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-4 space-y-4 text-xs">
          {/* Target Color */}
          <div className="flex items-center justify-between">
            <label className="text-slate-700 dark:text-slate-300 font-medium">置換対象の色 (From):</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={targetHex}
                onChange={(e) => setTargetHex(e.target.value)}
                className="w-7 h-7 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={targetHex}
                onChange={(e) => setTargetHex(e.target.value)}
                className="w-20 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded px-1.5 py-1 text-center font-mono"
              />
            </div>
          </div>

          {/* New Color */}
          <div className="flex items-center justify-between">
            <label className="text-slate-700 dark:text-slate-300 font-medium">変更後の新しい色 (To):</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value)}
                className="w-7 h-7 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value)}
                className="w-20 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded px-1.5 py-1 text-center font-mono"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setActiveModal(null)}
            className="px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium"
          >
            キャンセル
          </button>
          <button
            onClick={handleExecute}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold"
          >
            一括置換を実行
          </button>
        </div>
      </div>
    </div>
  );
};
