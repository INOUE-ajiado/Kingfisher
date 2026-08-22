import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { X, ExternalLink } from 'lucide-react';
import { LogoTitle } from '../common/LogoTitle';

export const AboutModal: React.FC = () => {
  const { activeModal, setActiveModal } = usePaintStore();

  if (activeModal !== 'about') return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-96 p-5 animate-in fade-in zoom-in-95 duration-150 relative">
        <button
          onClick={() => setActiveModal(null)}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <img
            src="/icon.jpg"
            alt="Kingfisher Icon"
            className="w-16 h-16 rounded-xl object-cover shadow-md border-2 border-blue-500/20 mb-3"
          />
          <LogoTitle size="md" showSubtitle={true} />

          <p className="text-xs text-slate-600 dark:text-slate-300 mt-4 leading-relaxed">
            アニメーションの彩色・仕上げ作業をブラウザ上で高速かつ直感的に行える、プロフェッショナル向け Web Studio アプリケーション。
          </p>

          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 w-full flex justify-between items-center text-[11px]">
            <a
              href="https://kingfisher-paint-2026.web.app"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium"
            >
              <span>Web Studio</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-slate-400">© 2026 Kingfisher Team</span>
          </div>
        </div>
      </div>
    </div>
  );
};
