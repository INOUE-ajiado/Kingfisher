import React, { useState, useEffect } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { convertImageToSVG } from '../../engine/vectorTrace';
import { X, Download, Sliders, FileCode, Check, Loader2 } from 'lucide-react';

export const ExportVectorModal: React.FC = () => {
  const { activeModal, setActiveModal, currentImage, unifiedFileList, currentFileIndex } = usePaintStore();
  const [tolerance, setTolerance] = useState<number>(1.0);
  const [ignoreWhite, setIgnoreWhite] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [svgString, setSvgString] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const isOpen = activeModal === 'exportVector';

  // 非同期・メモリ安全なSVGトレース変換
  useEffect(() => {
    if (!isOpen || !currentImage) {
      setSvgString('');
      return;
    }

    setIsProcessing(true);
    const timer = setTimeout(() => {
      try {
        const svg = convertImageToSVG(currentImage, { tolerance, ignoreWhite });
        setSvgString(svg);
      } catch (err) {
        console.error('Failed to trace vector SVG:', err);
      } finally {
        setIsProcessing(false);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, currentImage, tolerance, ignoreWhite]);

  if (!isOpen) return null;

  const fileName = (unifiedFileList[currentFileIndex] || 'Cell_0001.tga').replace(/\.[^/.]+$/, '');
  const svgByteSize = svgString ? new Blob([svgString]).size : 0;
  const formattedSize = (svgByteSize / 1024).toFixed(1);

  // SVGファイルダウンロード保存
  const handleDownloadSVG = () => {
    if (!svgString) return;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_vector.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // クリップボードへコピー
  const handleCopySVG = () => {
    if (!svgString) return;
    navigator.clipboard.writeText(svgString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[9999] p-4 select-none animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="h-10 bg-slate-100 dark:bg-slate-800/80 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 font-bold text-xs text-slate-800 dark:text-slate-100">
            <FileCode className="w-4 h-4 text-blue-500" />
            <span>ベクター出力 (SVGトレース) - {fileName}.svg</span>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* コンテンツメイン */}
        <div className="p-4 flex flex-col md:flex-row gap-4 overflow-hidden">
          {/* 左側: 設定・パラメーター */}
          <div className="w-full md:w-64 flex flex-col gap-4 text-xs">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                <Sliders className="w-3.5 h-3.5 text-blue-500" />
                <span>トレース設定 (Vector Options)</span>
              </div>

              {/* スムージング Tolerance */}
              <div>
                <div className="flex justify-between items-center mb-1 text-[11px]">
                  <span className="text-slate-600 dark:text-slate-400">スムージング (Tolerance):</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{tolerance.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.1"
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                  <span>高精細 (0.1)</span>
                  <span>滑らか (5.0)</span>
                </div>
              </div>

              {/* 背景の透過 */}
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 font-semibold pt-1">
                <input
                  type="checkbox"
                  checked={ignoreWhite}
                  onChange={(e) => setIgnoreWhite(e.target.checked)}
                  className="rounded accent-blue-600 w-4 h-4 cursor-pointer"
                />
                <span>純白背景を透過にする</span>
              </label>
            </div>

            {/* 情報カード */}
            <div className="bg-blue-50 dark:bg-blue-950/40 p-3 rounded-lg border border-blue-200 dark:border-blue-800 text-[10px] text-blue-800 dark:text-blue-300 space-y-1">
              <div className="font-bold">✨ スケーラブルベクターの特徴</div>
              <p className="leading-relaxed opacity-90">
                4K/8K解像度へ拡大してもピクセルのジャギーが出ず、容量を最適化した軽量ベクターアセットとしてWebアニメ等でそのまま利用できます。
              </p>
              <div className="pt-1 font-mono text-[9px] text-blue-600 dark:text-blue-400 font-bold">
                SVG容量: {formattedSize} KB
              </div>
            </div>
          </div>

          {/* 右側: リアルタイムSVGプレビュー */}
          <div className="flex-1 flex flex-col gap-2 min-h-[220px]">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">SVG ベクタープレビュー:</span>
            <div className="flex-1 bg-slate-200 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 flex items-center justify-center overflow-hidden relative min-h-[200px]">
              {isProcessing ? (
                <div className="flex flex-col items-center gap-2 text-blue-500 text-xs font-semibold">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  <span>ベクトルトレース生成中...</span>
                </div>
              ) : svgString ? (
                <div
                  className="w-full h-full max-h-[240px] flex items-center justify-center"
                  dangerouslySetInnerHTML={{ __html: svgString }}
                />
              ) : (
                <span className="text-slate-400 text-xs">セル画像が読み込まれていません</span>
              )}
            </div>
          </div>
        </div>

        {/* フッターアクション */}
        <div className="h-12 bg-slate-50 dark:bg-slate-800/80 px-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            onClick={handleCopySVG}
            disabled={!svgString || isProcessing}
            className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <FileCode className="w-3.5 h-3.5" />}
            <span>{copied ? 'コピー完了' : 'SVGコードをコピー'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveModal(null)}
              className="px-3 py-1.5 rounded text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleDownloadSVG}
              disabled={!svgString || isProcessing}
              className="px-4 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>SVGファイルを保存</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
