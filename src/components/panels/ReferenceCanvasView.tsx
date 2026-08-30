import React, { useRef, useEffect, useState } from 'react';
import { X, Maximize2, Minimize2, Pipette, FolderOpen } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { isSupportedImageFile } from '../../engine/fileSystemPath';
import { decodeAnyImageFile } from '../../engine/imageDecode';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { CornerResizeHandles } from '../common/CornerResizeHandles';

interface ReferenceCanvasViewProps {
  /** ドッキング領域のハイライト表示を親へ伝える */
  onDockHoverChange?: (isOver: boolean) => void;
}

/**
 * 色指定・作画比較用の参照画像ウィンドウ。
 *
 * ドッキング状態と独立ウィンドウ状態を「同じ 1 つの要素」で扱う。
 * 以前は状態ごとに別インスタンスを 2 つマウントしていたため、
 * 引きはがした直後のウィンドウがマウスに追従しなかった。
 */
export const ReferenceCanvasView: React.FC<ReferenceCanvasViewProps> = React.memo(({ onDockHoverChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isFloating = usePaintStore((s) => s.referenceCanvas.isFloating);
  const {
    referenceCanvas,
    closeReferenceWindow,
    toggleReferenceFloating,
    setReferenceTransform,
    pickColorFromReference,
    openReferenceImage,
    setActiveDragColor,
  } = usePaintStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // ⚡ 超高速 GPU コンポジタ追従用 Direct DOM Ref
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipBoxRef = useRef<HTMLDivElement | null>(null);
  const tooltipTextRef = useRef<HTMLSpanElement | null>(null);

  // 引きはがし・移動・リサイズ・ドッキング復帰・重なり順の共通処理
  const {
    targetRef,
    windowStyle,
    handleHeaderPointerDown,
    getResizeHandler,
    isOverDockTarget,
    bringToFront,
  } = useFloatingWindow({
    id: 'reference',
    isFloating,
    getIsFloating: () => usePaintStore.getState().referenceCanvas.isFloating,
    toggleFloating: () => usePaintStore.getState().toggleReferenceFloating(),
    dockTargetId: 'reference-dock-target',
    minWidth: 240,
    minHeight: 200,
  });

  useEffect(() => {
    onDockHoverChange?.(isOverDockTarget);
  }, [isOverDockTarget, onDockHoverChange]);

  // Drag & Drop ハイライトステート
  const [isDragOver, setIsDragOver] = useState(false);

  const refImage = referenceCanvas.image;

  // Drag & Drop 画像ファイルドロップ受領制御
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const lower = file.name.toLowerCase();
    if (isSupportedImageFile(lower)) {
      try {
        const decoded = await decodeAnyImageFile(file);
        openReferenceImage(null, file.name, decoded);
      } catch (err) {
        console.error('Failed to load dropped reference image:', err);
        alert('参照画像の読み込みに失敗しました。');
      }
    } else {
      alert('対応している画像ファイル (.tga, .jpg, .png) をドロップしてください。');
    }
  };

  useEffect(() => {
    const renderCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas || !refImage) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (canvas.width !== refImage.width || canvas.height !== refImage.height) {
        canvas.width = refImage.width;
        canvas.height = refImage.height;
      }

      const imgData = ctx.createImageData(refImage.width, refImage.height);
      imgData.data.set(refImage.data);
      ctx.putImageData(imgData, 0, 0);
    };

    renderCanvas();
    const animId = requestAnimationFrame(renderCanvas);
    return () => cancelAnimationFrame(animId);
  }, [refImage, isFloating, referenceCanvas.isOpen]);

  const getPixelColorAt = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !refImage) return null;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);

    if (x >= 0 && x < refImage.width && y >= 0 && y < refImage.height) {
      const idx = (y * refImage.width + x) * 4;
      const r = refImage.data[idx];
      const g = refImage.data[idx + 1];
      const b = refImage.data[idx + 2];
      const a = refImage.data[idx + 3];
      const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;

      return { r, g, b, a, hex };
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // 中ボタン (1) または 右ボタン (2): パン移動
    if (e.button === 1 || e.button === 2) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - referenceCanvas.transform.offsetX, y: e.clientY - referenceCanvas.transform.offsetY });
      return;
    }

    // 🌟 左クリック (0): 最初のクリック色を完全に固定（Initial Color Lock）し超高速GPUドラッグ開始
    if (e.button === 0) {
      const colorObj = getPixelColorAt(e.clientX, e.clientY);
      if (colorObj) {
        pickColorFromReference(colorObj);
        setActiveDragColor(colorObj); // 最初のクリック色を固定ロック

        // DOM 要素の初期位置 ＆ 表示設定
        if (tooltipRef.current) {
          tooltipRef.current.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 14}px, 0)`;
          tooltipRef.current.style.display = 'flex';
        }
        if (tooltipBoxRef.current) {
          tooltipBoxRef.current.style.backgroundColor = colorObj.hex;
        }
        if (tooltipTextRef.current) {
          tooltipTextRef.current.innerText = `${colorObj.hex} (ColorChartへドロップ)`;
        }

        // ⚡ Direct DOM 全画面コンポジタドラッグ追従（ヌルヌル完全同期）
        const onGlobalPointerMove = (moveEvt: PointerEvent) => {
          if (tooltipRef.current) {
            tooltipRef.current.style.transform = `translate3d(${moveEvt.clientX + 14}px, ${moveEvt.clientY + 14}px, 0)`;
          }
        };

        const cleanupDrag = () => {
          window.removeEventListener('pointermove', onGlobalPointerMove, true);
          window.removeEventListener('pointerup', cleanupDrag, true);
          window.removeEventListener('mouseup', cleanupDrag, true);
          window.removeEventListener('pointercancel', cleanupDrag, true);
          window.removeEventListener('blur', cleanupDrag);

          if (tooltipRef.current) {
            tooltipRef.current.style.display = 'none';
          }

          setTimeout(() => {
            setActiveDragColor(null);
          }, 50);
        };

        window.addEventListener('pointermove', onGlobalPointerMove, true);
        window.addEventListener('pointerup', cleanupDrag, true);
        window.addEventListener('mouseup', cleanupDrag, true);
        window.addEventListener('pointercancel', cleanupDrag, true);
        window.addEventListener('blur', cleanupDrag);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setReferenceTransform({
        ...referenceCanvas.transform,
        offsetX: e.clientX - panStart.x,
        offsetY: e.clientY - panStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    if (isPanning) setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(0.2, referenceCanvas.transform.scale * zoomFactor), 5.0);
    setReferenceTransform({ ...referenceCanvas.transform, scale: newScale });
  };

  // ⚠️ 完全シームレスな引きはがし (Tear-off) ＆ 独立ウィンドウ自由移動ハンドラー

  return (
    <div
      ref={targetRef}
      style={windowStyle}
      onPointerDownCapture={bringToFront}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col bg-white dark:bg-slate-900 ${isFloating ? 'border-2 rounded shadow-2xl' : 'border flex-1'} ${
        isOverDockTarget
          ? 'border-blue-500 ring-4 ring-blue-500/50'
          : isDragOver
          ? 'border-amber-400 ring-4 ring-amber-400/50'
          : 'border-emerald-600 dark:border-emerald-700'
      } relative`}
    >
      {/* ドラッグ＆ドロップ受領オーバーレイ */}
      {isDragOver && (
        <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-xs border-2 border-dashed border-amber-300 rounded flex flex-col items-center justify-center text-amber-300 z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none">
          <FolderOpen className="w-8 h-8 mb-2 animate-bounce" />
          <span className="font-bold text-xs">ここにドロップして参照画像を開く</span>
          <span className="text-[9px] opacity-80 mt-1">.tga / .jpg / .png に対応</span>
        </div>
      )}

      {/* ドッキング復帰ガイドオーバーレイ */}
      {isFloating && isOverDockTarget && (
        <div className="absolute inset-0 bg-blue-950/80 backdrop-blur-xs border-2 border-dashed border-blue-400 rounded flex flex-col items-center justify-center text-blue-200 z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none">
          <Minimize2 className="w-8 h-8 mb-2 animate-pulse text-blue-400" />
          <span className="font-bold text-xs">ドロップしてタブ表示に戻す (Docking)</span>
        </div>
      )}

      {/* ⚠️ タブ（タイトルバー）: Drag to tear off (独立化) & Drag to dock (復帰) */}
      <div
        onPointerDown={handleHeaderPointerDown}
        className="h-6 bg-gradient-to-r from-emerald-600 to-emerald-500 dark:from-emerald-800 dark:to-emerald-700 text-white flex items-center justify-between px-2 text-[11px] font-bold select-none touch-none cursor-grab active:cursor-grabbing shadow-xs"
      >
        <div className="flex items-center gap-1.5 truncate">
          <Pipette className="w-3.5 h-3.5 text-emerald-200" />
          <span>【参照】 {referenceCanvas.fileName}</span>
          <span className="text-[9px] opacity-80 font-normal ml-1 hidden sm:inline">
            ({isFloating ? 'ドラッグでドッキング領域へドロップ' : 'タブをドラッグで独立ウィンドウ化'})
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleReferenceFloating();
            }}
            title={referenceCanvas.isFloating ? 'ドッキングに戻す' : '切り離してフローティング表示'}
            className="p-0.5 hover:bg-emerald-700/80 rounded transition-colors"
          >
            {referenceCanvas.isFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeReferenceWindow();
            }}
            title="参照ウィンドウを閉じる"
            className="p-0.5 hover:bg-red-600 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* キャンバス領域 (Read-Only) */}
      <div
        className="flex-1 bg-slate-200 dark:bg-slate-900 relative flex items-center justify-center overflow-hidden cursor-crosshair"
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {refImage ? (
          <>
            <div
              style={{
                transform: `translate(${referenceCanvas.transform.offsetX}px, ${referenceCanvas.transform.offsetY}px) scale(${referenceCanvas.transform.scale})`,
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 0.05s ease-out',
              }}
              className="shadow-2xl border border-slate-300 dark:border-emerald-900/50 bg-white relative"
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={(e) => e.preventDefault()}
                className="block cursor-crosshair"
              />
            </div>

            {/* ワイヤーフレーム準拠のアクション案内ラベル */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-900/90 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide pointer-events-none shadow-md whitespace-nowrap">
              ドラッグ＆ドロップでColorChartへ色登録 {referenceCanvas.autoRevertTool ? '(Auto-Revert)' : ''}
            </div>

            {/* ⚡ 超高速 Direct DOM GPU コンポジタ描画カーソル追従カラーチップ */}
            <div
              id="eyedropper-drag-tooltip"
              ref={tooltipRef}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                display: 'none',
                willChange: 'transform',
                zIndex: 9999,
              }}
              className="pointer-events-none items-center gap-1.5 bg-slate-900/90 text-white px-2.5 py-1 rounded-full shadow-2xl border border-white/40 select-none"
            >
              <div
                ref={tooltipBoxRef}
                className="w-4 h-4 rounded-full border border-white shadow-xs"
              />
              <span ref={tooltipTextRef} className="text-[10px] font-mono font-bold">
                #FFFFFF (ColorChartへドロップ)
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-5 text-center bg-white/95 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl shadow-lg backdrop-blur m-4 select-none">
            <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mb-2 text-emerald-600 dark:text-emerald-400">
              <Pipette className="w-5 h-5" />
            </div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">NO REFERENCE IMAGE</h4>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
              画像をここにドラッグ＆ドロップ、または<br />ファイル &gt; 参照画像として開く (Ctrl+O)
            </p>
          </div>
        )}
      </div>

      {/* ⚡ フローティング時の全4角マルチリサイズグリップ */}
      {isFloating && <CornerResizeHandles getResizeHandler={getResizeHandler} topOffset={24} />}
    </div>
  );
});
