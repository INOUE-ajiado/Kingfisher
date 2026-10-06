import React, { useState, useEffect } from 'react';
import { Disc, X } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';

export const BdNotificationToast: React.FC = () => {
  const { setActiveModal, activeModal } = usePaintStore();
  const [detectedDiscName, setDetectedDiscName] = useState<string | null>(null);
  const [dismissedName, setDismissedName] = useState<string | null>(null);

  useEffect(() => {
    let timer: number;
    const checkStatus = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/status');
        if (res.ok) {
          const data = await res.json();
          const bdmvDisc = data.discs?.find((d: any) => d.isBdmv);
          if (bdmvDisc) {
            setDetectedDiscName(bdmvDisc.name);
          } else {
            setDetectedDiscName(null);
          }
        }
      } catch {
        // ヘルパー未起動時は何もしない
      }
    };

    void checkStatus();
    timer = window.setInterval(checkStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!detectedDiscName || detectedDiscName === dismissedName || activeModal === 'bdImport') {
    return null;
  }

  return (
    <div className="fixed bottom-10 right-4 z-50 bg-slate-900/95 border border-indigo-500/50 rounded-xl shadow-2xl p-3.5 flex items-center gap-3 backdrop-blur-md animate-in slide-in-from-bottom-5 duration-200 select-none max-w-sm">
      <div className="w-9 h-9 rounded-full bg-indigo-950 flex items-center justify-center flex-shrink-0 text-indigo-400 border border-indigo-500/30">
        <Disc className="w-5 h-5 animate-spin-slow" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-xs text-indigo-300 flex items-center gap-1">
          <span>Blu-rayディスクを検出</span>
        </div>
        <div className="text-[11px] text-slate-300 truncate font-mono mt-0.5">
          {detectedDiscName}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => setActiveModal('bdImport')}
          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] flex items-center gap-1 transition-colors shadow-xs"
        >
          <span>取り込み</span>
        </button>
        <button
          onClick={() => setDismissedName(detectedDiscName)}
          title="閉じる"
          className="p-1 rounded text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
