import React, { useState, useEffect } from 'react';
import { LogoTitle } from './LogoTitle';
import { Monitor, Smartphone, AlertTriangle, MonitorCheck } from 'lucide-react';

export const MobileGuard: React.FC = () => {
  const [windowWidth, setWindowWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1200);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 横幅 1024px 以上は PC 画面と判定してガードを非表示
  if (windowWidth >= 1024) return null;

  return (
    <div className="fixed inset-0 z-[99999] bg-slate-900/95 backdrop-blur-md text-slate-100 flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-200">
      <div className="max-w-md w-full bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
        {/* 上部装飾アクセント */}
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-blue-600 via-teal-400 to-orange-500" />

        {/* KINGFISHER ロゴ */}
        <div className="mb-6 transform scale-110">
          <LogoTitle size="md" />
        </div>

        {/* 警告イラスト風アイコン */}
        <div className="relative mb-5 flex items-center justify-center">
          <div className="w-20 h-20 rounded-2xl bg-slate-700/60 border border-slate-600 flex items-center justify-center text-amber-400 shadow-inner">
            <Monitor className="w-10 h-10 text-blue-400" />
          </div>
          <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-red-600 border-2 border-slate-800 flex items-center justify-center text-white shadow-lg animate-pulse">
            <Smartphone className="w-5 h-5" />
          </div>
        </div>

        {/* メイン警告タイトル */}
        <h2 className="text-lg font-bold text-slate-100 mb-2 flex items-center justify-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <span>PC（デスクトップ）画面専用です</span>
        </h2>

        {/* 説明テキスト */}
        <p className="text-xs text-slate-300 leading-relaxed mb-6">
          本システム（<strong className="text-blue-400">++KINGFISHER..</strong>）は、アニメーション制作の仕上げ作業を最適化するための <strong className="text-slate-100">PC（大画面・マウス / ペンタブレット環境）専用</strong> アプリケーションです。<br />
          スマートフォンや縦画面のモバイル端末ではご利用いただけません。
        </p>

        {/* ディスプレイ仕様案内カード */}
        <div className="w-full bg-slate-900/80 border border-slate-700/60 rounded-xl p-3.5 text-left mb-5 space-y-2 text-[11px]">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5">
              <MonitorCheck className="w-4 h-4 text-emerald-400" />
              必要動作環境:
            </span>
            <span className="font-mono font-bold text-slate-200">横幅 1024px 以上 (PC)</span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>現在の画面サイズ:</span>
            <span className="font-mono font-bold text-amber-400">{windowWidth}px</span>
          </div>
        </div>

        {/* 促しフッター */}
        <div className="text-[10px] text-slate-400">
          PC（デスクトップ / ノートPC）のブラウザよりアクセスしてください。
        </div>
      </div>
    </div>
  );
};
