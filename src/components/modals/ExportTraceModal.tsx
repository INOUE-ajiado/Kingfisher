import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { useRasterTraceWorker } from '../../hooks/useRasterTraceWorker';
import { RasterTraceMode, hexToRgb, rgbToHex } from '../../engine/rasterTrace';
import { encodeTGA } from '../../engine/tga';
import { X, Download, Sliders, Image as ImageIcon, Pipette, Loader2, Sparkles, Check } from 'lucide-react';

export const ExportTraceModal: React.FC = () => {
  const { activeModal, setActiveModal, currentImage, unifiedFileList, currentFileIndex } = usePaintStore();
  const [mode, setMode] = useState<RasterTraceMode>('unmultiply');
  const [keyColorHex, setKeyColorHex] = useState<string>('#ffffff');
  const [tolerance, setTolerance] = useState<number>(30);
  const [isEyedropperActive, setIsEyedropperActive] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const { processedBuffer, isProcessing, requestRasterTrace } = useRasterTraceWorker();

  const isOpen = activeModal === 'exportTrace';

  // 非同期透過トレースリクエスト
  useEffect(() => {
    if (isOpen && currentImage) {
      const rgb = hexToRgb(keyColorHex);
      requestRasterTrace(currentImage, { mode, keyColor: rgb, tolerance });
    }
  }, [isOpen, currentImage, mode, keyColorHex, tolerance, requestRasterTrace]);

  // プレビュー Canvas 描画
  useEffect(() => {
    if (!isOpen || !currentImage || !processedBuffer || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    canvas.width = currentImage.width;
    canvas.height = currentImage.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const clampedData = new Uint8ClampedArray(processedBuffer.buffer.slice(0) as ArrayBuffer);
    const imgData = new ImageData(clampedData, currentImage.width, currentImage.height);
    ctx.putImageData(imgData, 0, 0);
  }, [isOpen, currentImage, processedBuffer]);

  // プレビューキャンバスからのスポイト色取得
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isEyedropperActive || !currentImage || !previewCanvasRef.current) return;

      const canvas = previewCanvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = currentImage.width / rect.width;
      const scaleY = currentImage.height / rect.height;

      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);

      if (x >= 0 && x < currentImage.width && y >= 0 && y < currentImage.height) {
        const idx = (y * currentImage.width + x) * 4;
        const r = currentImage.data[idx];
        const g = currentImage.data[idx + 1];
        const b = currentImage.data[idx + 2];

        setKeyColorHex(rgbToHex(r, g, b));
        setIsEyedropperActive(false);
      }
    },
    [isEyedropperActive, currentImage]
  );

  if (!isOpen) return null;

  const fileName = (unifiedFileList[currentFileIndex] || 'Cell_0001.tga').replace(/\.[^/.]+$/, '');

  // PNG エクスポート保存
  const handleDownloadPNG = () => {
    if (!previewCanvasRef.current) return;
    previewCanvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}_traced.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDownloadSuccess('PNG');
      setTimeout(() => setDownloadSuccess(null), 2500);
    }, 'image/png');
  };

  // 32-bit TGA エクスポート保存
  const handleDownloadTGA = () => {
    if (!currentImage || !processedBuffer) return;
    const tgaImg = {
      width: currentImage.width,
      height: currentImage.height,
      pixelDepth: 32,
      data: processedBuffer,
    };
    const tgaBuffer = encodeTGA(tgaImg);
    const blob = new Blob([tgaBuffer], { type: 'application/x-tga' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_traced.tga`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setDownloadSuccess('TGA');
    setTimeout(() => setDownloadSuccess(null), 2500);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 sm:p-6 select-none animate-in fade-in duration-150">
      {/* 🌟 大型・ワイド画面モーダル (max-w-6xl h-[85vh]) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="h-11 bg-slate-100 dark:bg-slate-800/90 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
            <ImageIcon className="w-4 h-4 text-emerald-500" />
            <span>画像トレース / 背景透過エクスポート - {fileName}</span>
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
          {/* 左側: パラメータ設定 */}
          <div className="w-full md:w-80 flex flex-col gap-4 text-xs flex-shrink-0">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-4 shadow-xs">
              <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">
                <Sliders className="w-4 h-4 text-emerald-500" />
                <span>透過トレース設定</span>
              </div>

              {/* 1. 抽出モード (Extraction Mode) */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">抽出モード (Mode):</label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200 dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-800">
                  <button
                    onClick={() => setMode('unmultiply')}
                    className={`py-1.5 rounded text-[11px] font-bold transition-all ${
                      mode === 'unmultiply'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    線画抽出 (Unmultiply)
                  </button>
                  <button
                    onClick={() => setMode('colorKey')}
                    className={`py-1.5 rounded text-[11px] font-bold transition-all ${
                      mode === 'colorKey'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    カラーキー (Color Key)
                  </button>
                </div>
              </div>

              {/* 2. 対象カラー (Key Color) - Color Key モード時のみ */}
              {mode === 'colorKey' && (
                <div>
                  <div className="flex justify-between items-center mb-1 text-xs font-bold text-slate-700 dark:text-slate-300">
                    <span>対象カラー (Key Color):</span>
                    <button
                      onClick={() => setIsEyedropperActive(!isEyedropperActive)}
                      className={`px-2 py-0.5 rounded text-[10px] flex items-center gap-1 border border-slate-300 dark:border-slate-700 transition-all ${
                        isEyedropperActive ? 'bg-amber-500 text-white border-amber-500 font-bold animate-pulse' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <Pipette className="w-3 h-3" />
                      <span>{isEyedropperActive ? 'スポイト中' : 'スポイト'}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={keyColorHex}
                      onChange={(e) => setKeyColorHex(e.target.value)}
                      className="w-9 h-9 rounded cursor-pointer border border-slate-300 dark:border-slate-700 p-0.5 bg-white dark:bg-slate-800"
                    />
                    <input
                      type="text"
                      value={keyColorHex}
                      onChange={(e) => setKeyColorHex(e.target.value)}
                      className="flex-1 font-mono uppercase px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-bold"
                    />
                  </div>
                </div>
              )}

              {/* 3. 許容値 (Tolerance) - Color Key モード時のみ */}
              {mode === 'colorKey' && (
                <div>
                  <div className="flex justify-between items-center mb-1 text-xs font-medium">
                    <span className="text-slate-700 dark:text-slate-300 font-bold">許容値 (Tolerance):</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                      {tolerance}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={tolerance}
                    onChange={(e) => setTolerance(Number(e.target.value))}
                    className="w-full accent-emerald-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 mt-0.5 font-semibold">
                    <span>厳密 (1)</span>
                    <span>広域透過 (100)</span>
                  </div>
                </div>
              )}
            </div>

            {/* モード説明カード */}
            <div className="bg-emerald-50 dark:bg-emerald-950/40 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 space-y-2 flex-1">
              <div className="font-bold text-sm flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                <Sparkles className="w-4 h-4" />
                <span>{mode === 'unmultiply' ? '線画抽出 (Unmultiply)' : 'カラーキートレース'}</span>
              </div>
              <p className="leading-relaxed text-[11px] opacity-90">
                {mode === 'unmultiply'
                  ? '白背景のスキャン線画用です。アンチエイリアスのグレーを逆算して完璧な半透明アルファとして白フリンジなしで透過します。'
                  : '指定したカラー（純白・緑・青など）を背景色として透過します。Smoothstep 補間により境界線が綺麗に透過処理されます。'}
              </p>
            </div>
          </div>

          {/* 右側: リアルタイム市松模様プレビュー */}
          <div className="flex-1 flex flex-col gap-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                透過プレビュー (市松背景): {isEyedropperActive && <span className="text-amber-500 font-bold ml-2">※ プレビュー画像をクリックして背景色を抽出してください</span>}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {currentImage ? `${currentImage.width} × ${currentImage.height} px` : ''}
              </span>
            </div>

            <div className="flex-1 border border-slate-300 dark:border-slate-800 rounded-xl p-4 flex items-center justify-center overflow-hidden relative shadow-inner checkerboard-pattern bg-slate-200 dark:bg-slate-950">
              {isProcessing ? (
                <div className="flex flex-col items-center gap-2 text-emerald-500 text-xs font-bold">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                  <span>背景透過トレース処理中...</span>
                </div>
              ) : (
                <canvas
                  ref={previewCanvasRef}
                  onClick={handleCanvasClick}
                  className={`max-w-full max-h-full w-auto h-auto object-contain shadow-lg ${
                    isEyedropperActive ? 'cursor-crosshair ring-4 ring-amber-500 rounded' : ''
                  }`}
                />
              )}
            </div>
          </div>
        </div>

        {/* フッターアクション */}
        <div className="h-14 bg-slate-50 dark:bg-slate-800/90 px-5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            {downloadSuccess && (
              <span className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-950 px-2.5 py-1 rounded border border-emerald-300 dark:border-emerald-800">
                <Check className="w-4 h-4 text-emerald-500" />
                <span>{downloadSuccess} ファイルの保存を完了しました！</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveModal(null)}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              キャンセル
            </button>

            <button
              onClick={handleDownloadPNG}
              disabled={!processedBuffer || isProcessing}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>透過 PNG 出力 (.png)</span>
            </button>

            <button
              onClick={handleDownloadTGA}
              disabled={!processedBuffer || isProcessing}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>32bit TGA 出力 (.tga)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
