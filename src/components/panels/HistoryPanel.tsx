import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { History, RotateCcw } from 'lucide-react';

export const HistoryPanel: React.FC = () => {
  const { historyStack, historyIndex, jumpToHistory } = usePaintStore();

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex flex-col shadow-sm select-none p-2 min-h-[120px]">
      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-200 dark:border-slate-700 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>History ({historyStack.length})</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0.5 text-xs max-h-[100px]">
        {historyStack.length === 0 ? (
          <div className="text-[10px] text-slate-400 dark:text-slate-500 py-2 text-center">
            No history recorded
          </div>
        ) : (
          historyStack.map((item, idx) => {
            const isActive = idx === historyIndex;
            return (
              <div
                key={idx}
                onClick={() => jumpToHistory(idx)}
                className={`px-2 py-1 rounded cursor-pointer flex items-center justify-between transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white font-medium shadow-sm'
                    : idx < historyIndex
                    ? 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-600'
                }`}
              >
                <span className="truncate">{item.label || `Action ${idx + 1}`}</span>
                {isActive && <RotateCcw className="w-3 h-3 text-white" />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
