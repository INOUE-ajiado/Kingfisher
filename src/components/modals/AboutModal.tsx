import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { X } from 'lucide-react';

export const AboutModal: React.FC = () => {
  const { activeModal, setActiveModal } = usePaintStore();

  if (activeModal !== 'about') return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-gradient-to-r from-blue-600 to-teal-500 p-4 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl">🐦</span>
            <h2 className="font-extrabold tracking-wider text-lg">KINGFISHER</h2>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 text-slate-700 text-xs space-y-4">
          <div>
            <div className="font-bold text-slate-900 text-sm">Web-Based Animation Painting Tool</div>
            <div className="text-slate-400 font-mono text-[11px]">Document Version 2.0 (White & Clean Edition)</div>
          </div>

          <p className="leading-relaxed text-slate-600">
            「Kingfisher」はアニメーション制作における彩色（仕上げ）工程をブラウザ上で完結させる、完全フロントエンド動作の高機能・超高速Webアプリケーションです。
          </p>

          <div className="bg-slate-50 p-3 rounded border border-slate-200 space-y-1">
            <div className="font-semibold text-slate-800">Tech Stack:</div>
            <ul className="list-disc list-inside text-slate-600 space-y-0.5 font-mono text-[11px]">
              <li>React 18 / TypeScript / Vite</li>
              <li>Zustand State Management</li>
              <li>File System Access API</li>
              <li>Wasm / WebGPU Shared Buffer Architecture</li>
            </ul>
          </div>

          <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-[11px] text-slate-400">
            <span>© 2026 Kingfisher Team</span>
            <button
              onClick={() => setActiveModal(null)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 rounded transition-colors text-xs"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
