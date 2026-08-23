import React, { useState, useEffect } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { useVectorTraceWorker } from '../../hooks/useVectorTraceWorker';
import { X, Download, Sliders, FileCode, Check, Loader2, Maximize2 } from 'lucide-react';

export const ExportVectorModal: React.FC = () => {
  const { activeModal, setActiveModal, currentImage, unifiedFileList, currentFileIndex } = usePaintStore();
  const [tolerance, setTolerance] = useState<number>(1.0);
  const [ignoreWhite, setIgnoreWhite] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const { svgString, isProcessing, requestTrace } = useVectorTraceWorker();

  const isOpen = activeModal === 'exportVector';

  // Web Worker によるゼロコピー非同期ベクタートレース
  useEffect(() => {
    if (isOpen && currentImage) {
      requestTrace(currentImage, { tolerance, ignoreWhite });
    }
  }, [isOpen, currentImage, tolerance, ignoreWhite, requestTrace]);

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
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 sm:p-6 select-none animate-in fade-in duration-150">
      {/* 🌟 大型・ワイド画面モーダル (max-w-6xl h-[85vh]) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="h-11 bg-slate-100 dark:bg-slate-800/90 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
            <FileCode className="w-4 h-4 text-blue-500" />
            <span>ベクター出力 (3次ベジェSVGトレース) - {fileName}.svg</span>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* コンテンツメイン */}
        <div className="flex-1 p-4 flex flex-col md:flex-row gap-5 overflow-hidden">
          {/* 左側: 設定・パラメーター */}
          <div className="w-full md:w-72 flex flex-col gap-4 text-xs flex-shrink-0">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-4 shadow-xs">
              <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
                <Sliders className="w-4 h-4 text-blue-500" />
                <span>トレース設定 (Vector Options)</span>
              </div>

              {/* スムージング Tolerance */}
              <div>
                <div className="flex justify-between items-center mb-1.5 text-xs font-medium">
                  <span className="text-slate-700 dark:text-slate-300">スムージング (Tolerance):</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                    {tolerance.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.1"
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-semibold">
                  <span>極高精細 (0.1)</span>
                  <span>滑らか (5.0)</span>
                </div>
              </div>

              {/* 背景の透過 */}
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 font-bold pt-1 select-none">
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
            <div className="bg-blue-50 dark:bg-blue-950/40 p-4 rounded-lg border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200 space-y-2 flex-1">
              <div className="font-bold text-sm flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                <Maximize2 className="w-4 h-4" />
                <span>3次ベジェ (Cubic Bezier)</span>
              </div>
              <p className="leading-relaxed text-[11px] opacity-90">
                アニメセルの線画とカラー領域を解像度非依存の3次ベジェ曲線へ変換します。4K/8Kへ拡張しても綺麗な輪郭を維持します。
              </p>
              <div className="pt-2 border-t border-blue-200/60 dark:border-blue-800/60 font-mono text-xs text-blue-600 dark:text-blue-400 font-bold">
                SVG容量: {formattedSize} KB
              </div>
            </div>
          </div>

          {/* 右側: 大画面リアルタイムSVGプレビュー */}
          <div className="flex-1 flex flex-col gap-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">大画面 SVG ベクタープレビュー:</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {currentImage ? `${currentImage.width} × ${currentImage.height} px` : ''}
              </span>
            </div>

            <div className="flex-1 bg-slate-200 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-4 flex items-center justify-center overflow-hidden relative shadow-inner">
              {isProcessing ? (
                <div className="flex flex-col items-center gap-2 text-blue-500 text-xs font-bold">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <span>高精度ベクトルトレース生成中...</span>
                </div>
              ) : svgString ? (
                <div
                  className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto [&>svg]:object-contain shadow-lg"
                  dangerouslySetInnerHTML={{ __html: svgString }}
                />
              ) : (
                <span className="text-slate-400 text-xs">セル画像が読み込まれていません</span>
              )}
            </div>
          </div>
        </div>

        {/* フッターアクション */}
        <div className="h-14 bg-slate-50 dark:bg-slate-800/90 px-5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
          <button
            onClick={handleCopySVG}
            disabled={!svgString || isProcessing}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <FileCode className="w-4 h-4" />}
            <span>{copied ? 'コピー完了' : 'SVGコードをコピー'}</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveModal(null)}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              キャンセル
            </button>

            <button
              onClick={handleDownloadSVG}
              disabled={!svgString || isProcessing}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center gap-2 shadow-md transition-colors"
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
