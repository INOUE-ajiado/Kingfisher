import React, { useState, useEffect, useRef } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { useVectorTraceWorker } from '../../hooks/useVectorTraceWorker';
import { X, Download, Sliders, FileCode, Check, Loader2, Terminal, Cpu } from 'lucide-react';

export const ExportVectorModal: React.FC = () => {
  // ⚠️ 閉じたあとに触らないよう、タイマーは必ず片づける
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current); }, []);

  const { activeModal, setActiveModal, currentImage, unifiedFileList, currentFileIndex } = usePaintStore();
  const [tolerance, setTolerance] = useState<number>(1.0);
  const [colorMerging, setColorMerging] = useState<number>(25); // 減色マージ閾値 (0〜100)
  const [despeckle, setDespeckle] = useState<number>(5); // ゴミ除去最小面積 (0〜50px)
  const [ignoreWhite, setIgnoreWhite] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const logTerminalRef = useRef<HTMLDivElement>(null);

  const [bgMatteMode, setBgMatteMode] = useState<'checkerboard' | 'black' | 'white' | 'magenta' | 'custom'>('checkerboard');
  const [customBgColor, setCustomBgColor] = useState<string>('#00ff00');

  const { svgString, isProcessing, progressPercent, statusMessage, debugLogs, requestTrace } = useVectorTraceWorker();

  const isOpen = activeModal === 'exportVector';

  // Web Worker によるゼロコピー非同期ベクタートレース
  useEffect(() => {
    if (isOpen && currentImage) {
      requestTrace(currentImage, { tolerance, ignoreWhite, colorMerging, despeckle });
    }
  }, [isOpen, currentImage, tolerance, ignoreWhite, colorMerging, despeckle, requestTrace]);

  // ターミナルログ追加時の自動最下部スクロール
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [debugLogs]);

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
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 sm:p-6 select-none animate-in fade-in duration-150">
      {/* 🌟 大型・ワイド画面モーダル (max-w-6xl h-[88vh]) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-6xl h-[88vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="h-11 bg-slate-100 dark:bg-slate-800/90 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
            <FileCode className="w-4 h-4 text-blue-500" />
            <span>ベクター出力 (減色 ＆ ノイズ除去SVGトレース) - {fileName}.svg</span>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 🌟 4フェーズリアルタイムプログレスバー (0% 〜 100%) */}
        {isProcessing && (
          <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 relative overflow-hidden flex-shrink-0">
            <div
              className="bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 h-full transition-all duration-200 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* コンテンツメイン */}
        <div className="flex-1 p-4 flex flex-col md:flex-row gap-5 overflow-hidden">
          {/* 左側: 設定・パラメーター ＆ ログビューア */}
          <div className="w-full md:w-80 flex flex-col gap-3 text-xs flex-shrink-0 overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3.5 shadow-xs flex-shrink-0">
              <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
                <Sliders className="w-4 h-4 text-blue-500" />
                <span>トレース設定 (Vector Options)</span>
              </div>

              {/* 減色しきい値 Color Merging */}
              <div>
                <div className="flex justify-between items-center mb-1 text-xs font-medium">
                  <span className="text-slate-700 dark:text-slate-300 font-bold">減色しきい値 (Color Merging):</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                    {colorMerging}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={colorMerging}
                  onChange={(e) => setColorMerging(Number(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
                />
                <div className="flex justify-between text-[9px] text-slate-400 mt-0.5 font-semibold">
                  <span>完全分離 (0)</span>
                  <span>セルアニメマージ (100)</span>
                </div>
              </div>

              {/* ノイズ除去 Despeckle / Area Threshold */}
              <div>
                <div className="flex justify-between items-center mb-1 text-xs font-medium">
                  <span className="text-slate-700 dark:text-slate-300 font-bold">ノイズ除去 (Despeckle):</span>
                  <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                    {despeckle} px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  value={despeckle}
                  onChange={(e) => setDespeckle(Number(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
                />
                <div className="flex justify-between text-[9px] text-slate-400 mt-0.5 font-semibold">
                  <span>全残し (0)</span>
                  <span>ゴミ破棄 (50px)</span>
                </div>
              </div>

              {/* スムージング Tolerance */}
              <div>
                <div className="flex justify-between items-center mb-1 text-xs font-medium">
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
                <div className="flex justify-between text-[9px] text-slate-400 mt-0.5 font-semibold">
                  <span>高精細 (0.1)</span>
                  <span>滑らか (5.0)</span>
                </div>
              </div>

              {/* 背景の透過 */}
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 font-bold pt-0.5 select-none">
                <input
                  type="checkbox"
                  checked={ignoreWhite}
                  onChange={(e) => setIgnoreWhite(e.target.checked)}
                  className="rounded accent-blue-600 w-4 h-4 cursor-pointer"
                />
                <span>純白背景を透過にする</span>
              </label>
            </div>

            {/* 進捗ステータス ＆ 情報カード */}
            <div className="bg-blue-50 dark:bg-blue-950/40 p-3 rounded-lg border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200 space-y-1.5 flex-shrink-0">
              <div className="font-bold text-xs flex items-center justify-between text-blue-700 dark:text-blue-300">
                <span className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Wasm/Worker 状態</span>
                </span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{progressPercent}%</span>
              </div>
              <div className="text-[11px] font-semibold text-blue-800 dark:text-blue-300 truncate">
                {isProcessing ? statusMessage : '準備完了'}
              </div>
              <div className="pt-1 border-t border-blue-200/60 dark:border-blue-800/60 font-mono text-[11px] text-blue-600 dark:text-blue-400 font-bold flex justify-between">
                <span>SVG容量:</span>
                <span>{formattedSize} KB</span>
              </div>
            </div>

            {/* 🌟 ターミナル型デバッグログビューア */}
            <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex flex-col overflow-hidden text-[10px] font-mono text-emerald-400">
              <div className="flex items-center gap-1 text-slate-400 border-b border-slate-800 pb-1 mb-1.5 font-bold flex-shrink-0">
                <Terminal className="w-3 h-3 text-emerald-500" />
                <span>TRACE CONSOLE LOG</span>
              </div>
              <div ref={logTerminalRef} className="flex-1 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-slate-700 pr-1">
                {debugLogs.map((log, i) => (
                  <div key={i} className="leading-tight opacity-90 break-all">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右側: 大画面リアルタイムSVGプレビュー */}
          <div className="flex-1 flex flex-col gap-2 overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">大画面 SVG ベクタープレビュー:</span>

                {/* 🌟 透過背景マット切替ボタン群 */}
                <div className="inline-flex items-center gap-1 bg-slate-200 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[10px]">
                  <button
                    onClick={() => setBgMatteMode('checkerboard')}
                    title="市松模様 (Checkerboard)"
                    className={`px-2 py-0.5 rounded font-bold transition-all ${
                      bgMatteMode === 'checkerboard' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    🏁 市松
                  </button>
                  <button
                    onClick={() => setBgMatteMode('black')}
                    title="純黒マット (#000000) - 白フリンジ・ドット抜け検知"
                    className={`px-2 py-0.5 rounded font-bold transition-all ${
                      bgMatteMode === 'black' ? 'bg-black text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    ⬛ 黒
                  </button>
                  <button
                    onClick={() => setBgMatteMode('white')}
                    title="純白マット (#FFFFFF) - 暗部塗り漏れ検知"
                    className={`px-2 py-0.5 rounded font-bold transition-all ${
                      bgMatteMode === 'white' ? 'bg-white text-slate-900 border border-slate-300 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    ⬜ 白
                  </button>
                  <button
                    onClick={() => setBgMatteMode('magenta')}
                    title="マゼンタマット (#FF00FF) - 補色コントラスト検知"
                    className={`px-2 py-0.5 rounded font-bold transition-all ${
                      bgMatteMode === 'magenta' ? 'bg-[#ff00ff] text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    🟪 マゼンタ
                  </button>
                  <label
                    title="カスタム背景色"
                    className={`px-1.5 py-0.5 rounded font-bold transition-all flex items-center gap-1 cursor-pointer ${
                      bgMatteMode === 'custom' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="bgVectorMatte"
                      checked={bgMatteMode === 'custom'}
                      onChange={() => setBgMatteMode('custom')}
                      className="hidden"
                    />
                    <span>🎨</span>
                    <input
                      type="color"
                      value={customBgColor}
                      onChange={(e) => {
                        setCustomBgColor(e.target.value);
                        setBgMatteMode('custom');
                      }}
                      className="w-3.5 h-3.5 rounded cursor-pointer border-0 p-0 bg-transparent"
                    />
                  </label>
                </div>
              </div>

              <span className="text-[10px] text-slate-400 font-mono">
                {currentImage ? `${currentImage.width} × ${currentImage.height} px` : ''}
              </span>
            </div>

            <div
              className={`flex-1 border border-slate-300 dark:border-slate-800 rounded-xl p-4 flex items-center justify-center overflow-hidden relative shadow-inner transition-colors ${
                bgMatteMode === 'checkerboard'
                  ? 'checkerboard-pattern bg-slate-200 dark:bg-slate-950'
                  : bgMatteMode === 'black'
                  ? 'bg-black'
                  : bgMatteMode === 'white'
                  ? 'bg-white'
                  : bgMatteMode === 'magenta'
                  ? 'bg-[#ff00ff]'
                  : ''
              }`}
              style={bgMatteMode === 'custom' ? { backgroundColor: customBgColor } : undefined}
            >
              {isProcessing ? (
                <div className="flex flex-col items-center gap-3 text-blue-500 text-xs font-bold">
                  <Loader2 className="w-9 h-9 animate-spin text-blue-500" />
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{statusMessage}</span>
                    <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{progressPercent}% 完了</span>
                  </div>
                </div>
              ) : svgString ? (
                <div
                  className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto [&>svg]:object-contain shadow-lg animate-in fade-in duration-200"
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
