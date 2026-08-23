import React, { useRef, useEffect, useState, useCallback } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { floodFill, gradientFill, closedAreaFill, drawBrushLine, removeSingleNoiseAt } from '../../engine/paintAlgorithm';
import { decodeTGA } from '../../engine/tga';
import { AlertTriangle, X, Maximize2, Minimize2, Pipette, FolderOpen } from 'lucide-react';
import { useFastDraggable } from '../../hooks/useFastDraggable';

function createCheckerPattern(ctx: CanvasRenderingContext2D, size: number = 8): CanvasPattern | null {
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = size * 2;
  patternCanvas.height = size * 2;
  const pCtx = patternCanvas.getContext('2d');
  if (!pCtx) return null;

  pCtx.fillStyle = '#FFFFFF';
  pCtx.fillRect(0, 0, size * 2, size * 2);
  pCtx.fillStyle = '#CBD5E1';
  pCtx.fillRect(0, 0, size, size);
  pCtx.fillRect(size, size, size, size);

  return ctx.createPattern(patternCanvas, 'repeat');
}

const ReferenceCanvasView: React.FC<{ isFloating?: boolean }> = React.memo(({ isFloating = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const [dragCursorPos, setDragCursorPos] = useState<{ x: number; y: number } | null>(null);

  // ⚠️ 最適化仕様書準拠: React State を介さない超高速 GPU コンポジトリドラッグフック
  const { targetRef, currentPos, setPosition } = useFastDraggable({
    initialX: 120,
    initialY: 80,
    enabled: isFloating,
  });

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
    if (lower.endsWith('.tga') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) {
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

  const pickColorFromPos = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !refImage) return;

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

      const colorObj = { r, g, b, a, hex };
      pickColorFromReference(colorObj);
      setActiveDragColor(colorObj);
      setDragCursorPos({ x: clientX, y: clientY });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // 中ボタン (1) または 右ボタン (2): パン移動
    if (e.button === 1 || e.button === 2) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - referenceCanvas.transform.offsetX, y: e.clientY - referenceCanvas.transform.offsetY });
      return;
    }

    // 🌟 左クリック (0): 参照画像からダイレクト色スポイト ＆ ドロップドラッグ準備
    if (e.button === 0) {
      pickColorFromPos(e.clientX, e.clientY);

      const onGlobalPointerUp = () => {
        window.removeEventListener('pointerup', onGlobalPointerUp);
        setActiveDragColor(null);
        setDragCursorPos(null);
      };
      window.addEventListener('pointerup', onGlobalPointerUp);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setReferenceTransform({
        ...referenceCanvas.transform,
        offsetX: e.clientX - panStart.x,
        offsetY: e.clientY - panStart.y,
      });
    } else if (e.buttons === 1) {
      // 左ボタンを押したままドラッグ中も連続で色を取得＆カーソルチップ更新
      pickColorFromPos(e.clientX, e.clientY);
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
  const isDraggingHeader = useRef(false);
  const dragOffset = useRef({ x: 160, y: 12 });
  const [isNearDockArea, setIsNearDockArea] = useState(false);

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    isDraggingHeader.current = true;

    if (isFloating && currentPos.current) {
      dragOffset.current = {
        x: e.clientX - currentPos.current.x,
        y: e.clientY - currentPos.current.y,
      };
    } else {
      dragOffset.current = { x: 160, y: 12 };
    }

    const onWindowPointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingHeader.current) return;

      const currentFloating = usePaintStore.getState().referenceCanvas.isFloating;

      if (!currentFloating) {
        // 1. 固定ウィンドウからの引きはがし判定
        const dist = Math.hypot(moveEvent.clientX - e.clientX, moveEvent.clientY - e.clientY);
        if (dist > 6) {
          const spawnX = Math.max(10, moveEvent.clientX - dragOffset.current.x);
          const spawnY = Math.max(10, moveEvent.clientY - dragOffset.current.y);
          setPosition(spawnX, spawnY);
          toggleReferenceFloating();
        }
      } else {
        // 2. 独立ウィンドウ時: 画面上どこへでも自由に即時移動
        const newX = Math.max(0, moveEvent.clientX - dragOffset.current.x);
        const newY = Math.max(0, moveEvent.clientY - dragOffset.current.y);
        setPosition(newX, newY);

        // タブドッキング判定（※タブ部分のみ）
        const tabElem1 = document.getElementById('docked-reference-tab');
        const tabElem2 = document.getElementById('docked-reference-tab-bar');
        const targetElem = (tabElem2 && tabElem2.offsetParent !== null) ? tabElem2 : tabElem1;

        if (targetElem) {
          const rect = targetElem.getBoundingClientRect();
          const padding = 25;
          const isOver =
            moveEvent.clientX >= rect.left - padding &&
            moveEvent.clientX <= rect.right + padding &&
            moveEvent.clientY >= rect.top - padding &&
            moveEvent.clientY <= rect.bottom + padding;

          setIsNearDockArea(isOver);
        } else {
          setIsNearDockArea(false);
        }
      }
    };

    const onWindowPointerUp = (upEvent: PointerEvent) => {
      isDraggingHeader.current = false;
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);

      const currentFloating = usePaintStore.getState().referenceCanvas.isFloating;
      if (currentFloating) {
        const tabElem1 = document.getElementById('docked-reference-tab');
        const tabElem2 = document.getElementById('docked-reference-tab-bar');
        const targetElem = (tabElem2 && tabElem2.offsetParent !== null) ? tabElem2 : tabElem1;

        if (targetElem) {
          const rect = targetElem.getBoundingClientRect();
          const padding = 25;
          const isOver =
            upEvent.clientX >= rect.left - padding &&
            upEvent.clientX <= rect.right + padding &&
            upEvent.clientY >= rect.top - padding &&
            upEvent.clientY <= rect.bottom + padding;

          if (isOver) {
            setIsNearDockArea(false);
            toggleReferenceFloating();
            return;
          }
        }

        // ドッキング外で離した場合: クリックを離した場所へ確定展開
        const finalX = Math.max(0, upEvent.clientX - dragOffset.current.x);
        const finalY = Math.max(0, upEvent.clientY - dragOffset.current.y);
        setPosition(finalX, finalY);
      }
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
  };

  return (
    <div
      ref={targetRef}
      style={isFloating ? { position: 'fixed', top: 0, left: 0, zIndex: 50 } : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col bg-slate-200 dark:bg-slate-900 border-2 ${
        isNearDockArea
          ? 'border-blue-500 ring-4 ring-blue-500/50'
          : isDragOver
          ? 'border-amber-400 ring-4 ring-amber-400/50'
          : 'border-emerald-600'
      } rounded overflow-hidden shadow-2xl relative ${
        isFloating ? 'w-80 h-96' : 'flex-1'
      }`}
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
      {isFloating && isNearDockArea && (
        <div className="absolute inset-0 bg-blue-950/80 backdrop-blur-xs border-2 border-dashed border-blue-400 rounded flex flex-col items-center justify-center text-blue-200 z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none">
          <Minimize2 className="w-8 h-8 mb-2 animate-pulse text-blue-400" />
          <span className="font-bold text-xs">ドロップしてタブ表示に戻す (Docking)</span>
        </div>
      )}

      {/* ⚠️ タブ（タイトルバー）: Drag to tear off (独立化) & Drag to dock (復帰) */}
      <div
        id={isFloating ? undefined : 'docked-reference-tab-bar'}
        onPointerDown={handleHeaderPointerDown}
        className="h-6 bg-gradient-to-r from-emerald-800 to-emerald-600 text-white flex items-center justify-between px-2 text-[11px] font-bold select-none touch-none cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5 truncate">
          <Pipette className="w-3.5 h-3.5 text-emerald-300" />
          <span>【参照】 {referenceCanvas.fileName}</span>
          <span className="text-[9px] opacity-75 font-normal ml-1 hidden sm:inline">
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
        className="flex-1 bg-slate-800 relative flex items-center justify-center overflow-hidden cursor-crosshair"
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
              className="shadow-2xl border border-emerald-900/50 bg-white relative"
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
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/80 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide pointer-events-none shadow whitespace-nowrap">
              ドラッグ＆ドロップでColorChartへ色登録 {referenceCanvas.autoRevertTool ? '(Auto-Revert)' : ''}
            </div>

            {/* 🌟 ドラッグ中カーソル追従カラープレビューチップ */}
            {dragCursorPos && (
              <div
                style={{ left: `${dragCursorPos.x + 12}px`, top: `${dragCursorPos.y + 12}px` }}
                className="fixed z-[9999] pointer-events-none flex items-center gap-1.5 bg-slate-900/90 text-white px-2 py-1 rounded-full shadow-2xl border border-white/40 animate-in fade-in duration-75"
              >
                <div
                  className="w-4 h-4 rounded-full border border-white shadow-xs"
                  style={{ backgroundColor: usePaintStore.getState().activeDragColor?.hex || '#ffffff' }}
                />
                <span className="text-[10px] font-mono font-bold">
                  {usePaintStore.getState().activeDragColor?.hex} (ColorChartへドロップ)
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-5 text-center bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl shadow-lg backdrop-blur m-4 select-none">
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
    </div>
  );
});

async function decodeAnyImageFile(file: File): Promise<any> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.tga')) {
    const buffer = await file.arrayBuffer();
    return decodeTGA(buffer);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context error'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      resolve({
        width: img.width,
        height: img.height,
        data: imgData.data,
        isReadOnly: true,
      });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

export const CellWindow: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const {
    fileListA,
    fileListB,
    unifiedFileList,
    currentFileIndex,
    splitFileIndex,
    isSplitView,
    syncMode,
    activeViewIndex,
    setActiveViewIndex,
    activeTool,
    toolOptions,
    currentColor,
    backgroundColor,
    setCurrentColor,
    currentImage,
    setCurrentImage,
    prevImage,
    nextImage,
    setPrevNextImages,
    canvasTransform,
    setCanvasTransform,
    splitCanvasTransform,
    setSplitCanvasTransform,
    lightTable,
    renderTrigger,
    triggerRender,
    folderHandleA,
    folderHandleB,
    folderNameA,
    folderNameB,
    fileMapA,
    fileMapB,
    saveUndoState,
    isPlaying,
    showGrid,
    showRuler,
    showUnpaintedFlash,
    pegStabilizer,
    referenceCanvas,
    colorSpecLayoutMode,
    isWinAFloating,
    isWinBFloating,
    toggleWinAFloating,
    toggleWinBFloating,
    setCustomDropFolderA,
    setCustomDropFolderB,
    canvasBgMatteMode,
    canvasCustomBgColor,
  } = usePaintStore();

  const winADrag = useFastDraggable({ initialX: 60, initialY: 60, enabled: isWinAFloating });
  const winBDrag = useFastDraggable({ initialX: 200, initialY: 80, enabled: isWinBFloating });

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);
  const [isLassoing, setIsLassoing] = useState(false);
  const [isBrushing, setIsBrushing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // ⌨️ Space キー検出 (Space キーを押している間は一時的にパン移動ツール化)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // エクスプローラーダイレクト D&D ドラッグオーバー・ステート
  const [isWinADragOver, setIsWinADragOver] = useState(false);
  const [isWinBDragOver, setIsWinBDragOver] = useState(false);

  // 📁 エクスプローラーからのフォルダ/ファイル直接ドロップ処理 (階層パス保持)
  const readDirectoryEntries = async (dirEntry: any, fileMap: Map<string, File>, currentPath = '') => {
    const dirReader = dirEntry.createReader();
    const entries: any[] = await new Promise((resolve) => {
      dirReader.readEntries((results: any[]) => resolve(results));
    });

    for (const entry of entries) {
      const relPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      if (entry.isFile) {
        const file: File | null = await new Promise((resolve) => (entry as any).file((f: File) => resolve(f), () => resolve(null)));
        if (file && /\.(tga|png|jpg|jpeg)$/i.test(file.name)) {
          fileMap.set(relPath, file);
        }
      } else if (entry.isDirectory) {
        await readDirectoryEntries(entry, fileMap, relPath);
      }
    }
  };

  const handleFolderOrFilesNativeDrop = async (e: React.DragEvent, targetWin: 'winA' | 'winB') => {
    e.preventDefault();
    e.stopPropagation();

    if (targetWin === 'winA') setIsWinADragOver(false);
    else setIsWinBDragOver(false);

    const items = e.dataTransfer.items;
    const files = e.dataTransfer.files;
    const fileMap = new Map<string, File>();
    let detectedFolderName: string | null = null;

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            if (entry.isDirectory) {
              if (!detectedFolderName) detectedFolderName = entry.name;
              await readDirectoryEntries(entry, fileMap, entry.name);
            } else if (entry.isFile) {
              const file: File | null = await new Promise((resolve) => (entry as any).file((f: File) => resolve(f), () => resolve(null)));
              if (file && /\.(tga|png|jpg|jpeg)$/i.test(file.name)) {
                const relPath = (file as any).webkitRelativePath || file.name;
                fileMap.set(relPath, file);
              }
            }
          }
        }
      }
    }

    if (fileMap.size === 0 && files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (/\.(tga|png|jpg|jpeg)$/i.test(file.name)) {
          const relPath = (file as any).webkitRelativePath || file.name;
          fileMap.set(relPath, file);
        }
      }
    }

    if (fileMap.size > 0) {
      const fileList = Array.from(fileMap.keys()).sort();
      const folderTitle = detectedFolderName || (targetWin === 'winA' ? 'ドロップフォルダ A' : 'ドロップフォルダ B');
      if (targetWin === 'winA') {
        setCustomDropFolderA(folderTitle, fileMap, fileList);
      } else {
        setCustomDropFolderB(folderTitle, fileMap, fileList);
      }
    }
  };

  // ⚠️ メインウィンドウ全般 (Win A / Win B) 共通引きはがし (Tear-off) ＆ ドッキングポインターハンドラー
  const isDraggingGenericHeader = useRef(false);
  const genericDragOffset = useRef({ x: 160, y: 12 });

  const handleGenericHeaderPointerDown = (
    e: React.PointerEvent,
    winId: 'winA' | 'winB',
    isFloating: boolean,
    currentPos: React.MutableRefObject<{ x: number; y: number }>,
    setPosition: (x: number, y: number) => void
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    isDraggingGenericHeader.current = true;

    if (isFloating && currentPos && currentPos.current) {
      genericDragOffset.current = {
        x: e.clientX - currentPos.current.x,
        y: e.clientY - currentPos.current.y,
      };
    } else {
      genericDragOffset.current = { x: 160, y: 12 };
    }

    const toggleFloating = winId === 'winA' ? toggleWinAFloating : toggleWinBFloating;
    const tabId = winId === 'winA' ? 'docked-winA-tab' : 'docked-winB-tab';

    const onWindowPointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingGenericHeader.current) return;

      const state = usePaintStore.getState();
      const currentIsFloating = winId === 'winA' ? state.isWinAFloating : state.isWinBFloating;

      if (!currentIsFloating) {
        const dist = Math.hypot(moveEvent.clientX - e.clientX, moveEvent.clientY - e.clientY);
        if (dist > 6) {
          const spawnX = Math.max(10, moveEvent.clientX - genericDragOffset.current.x);
          const spawnY = Math.max(10, moveEvent.clientY - genericDragOffset.current.y);
          setPosition(spawnX, spawnY);
          toggleFloating();
        }
      } else {
        const newX = Math.max(0, moveEvent.clientX - genericDragOffset.current.x);
        const newY = Math.max(0, moveEvent.clientY - genericDragOffset.current.y);
        setPosition(newX, newY);
      }
    };

    const onWindowPointerUp = (upEvent: PointerEvent) => {
      isDraggingGenericHeader.current = false;
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);

      const state = usePaintStore.getState();
      const currentIsFloating = winId === 'winA' ? state.isWinAFloating : state.isWinBFloating;

      if (currentIsFloating) {
        const targetElem = document.getElementById(tabId);
        if (targetElem && targetElem.offsetParent !== null) {
          const rect = targetElem.getBoundingClientRect();
          const padding = 25;
          const isOver =
            upEvent.clientX >= rect.left - padding &&
            upEvent.clientX <= rect.right + padding &&
            upEvent.clientY >= rect.top - padding &&
            upEvent.clientY <= rect.bottom + padding;

          if (isOver) {
            toggleFloating();
            return;
          }
        }

        const finalX = Math.max(0, upEvent.clientX - genericDragOffset.current.x);
        const finalY = Math.max(0, upEvent.clientY - genericDragOffset.current.y);
        setPosition(finalX, finalY);
      }
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
  };

  const [splitImage, setSplitImage] = useState<any>(null);
  const [onionFramesMap, setOnionFramesMap] = useState<Map<number, any>>(new Map());

  // 画面サイズ（PCディスプレイのキャンバスエリア高さ）に合わせて、仮想フレーム/セル画像が上下にぴったり収まるサイズに自動計算＆初期位置設定
  const fitToScreenHeight = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const availableHeight = container.clientHeight - 48; // 上下24pxずつのマージン余白
    const targetHeight = currentImage ? currentImage.height : 480;
    if (availableHeight <= 0 || targetHeight <= 0) return;

    const fitScale = Math.min(Math.max(0.2, availableHeight / targetHeight), 3.0);
    const fitTransform = { scale: fitScale, offsetX: 0, offsetY: 0 };

    setCanvasTransform(fitTransform);
    setSplitCanvasTransform(fitTransform);
  }, [currentImage, setCanvasTransform, setSplitCanvasTransform]);

  // 初回マウント時、画像読み込み時、およびウィンドウリサイズ時に上下フィット位置を適用
  useEffect(() => {
    fitToScreenHeight();
    const handleResize = () => fitToScreenHeight();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitToScreenHeight]);

  // オニオンスキン用マルチフレーム(前後最大5枚)の読み込み
  useEffect(() => {
    if (!lightTable.enabled || isPlaying) return;
    let isSubscribed = true;

    async function loadOnionFrames() {
      const pastCount = lightTable.pastFrames ?? 1;
      const futureCount = lightTable.futureFrames ?? 1;
      const loadedMap = new Map<number, any>();

      const fetchSingleFrame = async (targetIndex: number) => {
        if (targetIndex < 0 || targetIndex >= unifiedFileList.length) return null;
        const fileName = unifiedFileList[targetIndex];
        if (!fileName) return null;

        if (fileMapA.has(fileName)) {
          try {
            const file = fileMapA.get(fileName)!;
            const buffer = await file.arrayBuffer();
            return decodeTGA(buffer);
          } catch (e) {
            console.error('Failed to decode onion frame from fileMapA:', e);
          }
        }

        if (folderHandleA && fileListA.includes(fileName)) {
          try {
            const fileHandle = await folderHandleA.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const buffer = await file.arrayBuffer();
            return decodeTGA(buffer);
          } catch (e) {
            console.error('Failed to read onion frame from folderHandleA:', e);
          }
        }
        return null;
      };

      // 過去フレーム (offset = -1, -2, ...)
      for (let offset = -1; offset >= -pastCount; offset--) {
        const frame = await fetchSingleFrame(currentFileIndex + offset);
        if (frame) loadedMap.set(offset, frame);
      }

      // 未来フレーム (offset = 1, 2, ...)
      for (let offset = 1; offset <= futureCount; offset++) {
        const frame = await fetchSingleFrame(currentFileIndex + offset);
        if (frame) loadedMap.set(offset, frame);
      }

      if (isSubscribed) {
        setOnionFramesMap(loadedMap);
      }
    }

    loadOnionFrames();
    return () => { isSubscribed = false; };
  }, [
    currentFileIndex,
    lightTable.enabled,
    lightTable.pastFrames,
    lightTable.futureFrames,
    unifiedFileList,
    fileListA,
    fileMapA,
    folderHandleA,
    isPlaying,
  ]);

  // メイン画像の読み込み (Dir A / Unified)
  useEffect(() => {
    let isSubscribed = true;

    async function loadImage() {
      const currentFileName = unifiedFileList[currentFileIndex];
      if (!currentFileName) {
        if (isSubscribed) setCurrentImage(null);
        return;
      }

      if (fileMapA.has(currentFileName)) {
        try {
          const file = fileMapA.get(currentFileName)!;
          const decoded = await decodeAnyImageFile(file);
          if (isSubscribed) setCurrentImage(decoded);
          return;
        } catch (e) {
          console.error('Failed to decode image from fileMapA:', e);
        }
      }

      if (folderHandleA && fileListA.includes(currentFileName)) {
        try {
          const fileHandle = await folderHandleA.getFileHandle(currentFileName);
          const file = await fileHandle.getFile();
          const decoded = await decodeAnyImageFile(file);
          if (isSubscribed) setCurrentImage(decoded);
          return;
        } catch (e) {
          console.error('Failed to read image from folderHandleA:', e);
        }
      }

      if (isSubscribed) setCurrentImage(null);
    }

    loadImage();
    return () => { isSubscribed = false; };
  }, [currentFileIndex, unifiedFileList, fileListA, folderHandleA, fileMapA, setCurrentImage, setPrevNextImages]);

  // 分割右側ビュー画像の読み込み (Dir B / Unified)
  useEffect(() => {
    if (!isSplitView) return;
    let isSubscribed = true;

    async function loadSplitImage() {
      const splitFileName = unifiedFileList[splitFileIndex];
      if (!splitFileName) {
        if (isSubscribed) setSplitImage(null);
        return;
      }

      if (fileMapB.has(splitFileName)) {
        try {
          const file = fileMapB.get(splitFileName)!;
          const decoded = await decodeAnyImageFile(file);
          if (isSubscribed) setSplitImage(decoded);
          return;
        } catch (e) {
          console.error('Failed to decode image from fileMapB:', e);
        }
      }

      if (folderHandleB && fileListB.includes(splitFileName)) {
        try {
          const fileHandle = await folderHandleB.getFileHandle(splitFileName);
          const file = await fileHandle.getFile();
          const decoded = await decodeAnyImageFile(file);
          if (isSubscribed) setSplitImage(decoded);
          return;
        } catch (e) {
          console.error('Failed to read image from folderHandleB:', e);
        }
      }

      if (isSubscribed) setSplitImage(null);
    }

    loadSplitImage();
    return () => { isSubscribed = false; };
  }, [isSplitView, splitFileIndex, unifiedFileList, fileListB, folderHandleB, fileMapB]);

  // アニメーション再生
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const { currentFileIndex, unifiedFileList, setCurrentFileIndex } = usePaintStore.getState();
      const nextIdx = (currentFileIndex + 1) % unifiedFileList.length;
      setCurrentFileIndex(nextIdx);
    }, (1000 / usePaintStore.getState().fps) * toolOptions.frameHold);

    return () => clearInterval(interval);
  }, [isPlaying, toolOptions.frameHold]);

  // キャンバス描画
  const renderCanvasInstance = useCallback(
    (canvas: HTMLCanvasElement | null, targetImg: any, isLeft: boolean) => {
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (!targetImg) {
        canvas.width = 640;
        canvas.height = 480;
        const pattern = createCheckerPattern(ctx, 10);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      canvas.width = targetImg.width;
      canvas.height = targetImg.height;

      // 透過表現用チェッカーボード
      if (showUnpaintedFlash) {
        ctx.fillStyle = '#FF007F';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        const pattern = createCheckerPattern(ctx, 10);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }

      // 1. Draw Onion Skin Layers (オニオンスキン: 前後フレーム透過 & カラーコーディング)
      if (isLeft && lightTable.enabled && !isPlaying) {
        // A. 過去フレーム描画 (Past Frames: デフォルト 赤)
        const pastCount = lightTable.pastFrames ?? 1;
        for (let step = pastCount; step >= 1; step--) {
          const frameImg = onionFramesMap.get(-step) || (step === 1 ? prevImage : null);
          if (!frameImg) continue;

          const startOp = (lightTable.startOpacity ?? 30) / 100;
          const stepDecay = ((lightTable.opacityStep ?? 10) * (step - 1)) / 100;
          const frameAlpha = Math.max(0.05, startOp - stepDecay);

          const frameImgData = ctx.createImageData(frameImg.width, frameImg.height);
          const pColor = lightTable.pastColor || { r: 239, g: 68, b: 68 };
          const mode = lightTable.displayMode || (lightTable.colorMode === 'tinted' ? 'monochrome' : 'color');

          for (let i = 0; i < frameImg.data.length; i += 4) {
            const a = frameImg.data[i + 3];
            if (a > 0) {
              if (mode === 'monochrome') {
                const lum = (0.299 * frameImg.data[i] + 0.587 * frameImg.data[i + 1] + 0.114 * frameImg.data[i + 2]) / 255;
                frameImgData.data[i] = Math.round(lum * pColor.r);
                frameImgData.data[i + 1] = Math.round(lum * pColor.g);
                frameImgData.data[i + 2] = Math.round(lum * pColor.b);
                frameImgData.data[i + 3] = a;
              } else if (mode === 'half-color') {
                frameImgData.data[i] = Math.round((frameImg.data[i] + pColor.r) / 2);
                frameImgData.data[i + 1] = Math.round((frameImg.data[i + 1] + pColor.g) / 2);
                frameImgData.data[i + 2] = Math.round((frameImg.data[i + 2] + pColor.b) / 2);
                frameImgData.data[i + 3] = a;
              } else {
                frameImgData.data[i] = frameImg.data[i];
                frameImgData.data[i + 1] = frameImg.data[i + 1];
                frameImgData.data[i + 2] = frameImg.data[i + 2];
                frameImgData.data[i + 3] = a;
              }
            }
          }

          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = frameImg.width;
          tempCanvas.height = frameImg.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            tempCtx.putImageData(frameImgData, 0, 0);
            ctx.globalAlpha = frameAlpha;
            ctx.drawImage(tempCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
          }
        }

        // B. 未来フレーム描画 (Future Frames: デフォルト 青)
        const futureCount = lightTable.futureFrames ?? 1;
        for (let step = 1; step <= futureCount; step++) {
          const frameImg = onionFramesMap.get(step) || (step === 1 ? nextImage : null);
          if (!frameImg) continue;

          const startOp = (lightTable.startOpacity ?? 30) / 100;
          const stepDecay = ((lightTable.opacityStep ?? 10) * (step - 1)) / 100;
          const frameAlpha = Math.max(0.05, startOp - stepDecay);

          const frameImgData = ctx.createImageData(frameImg.width, frameImg.height);
          const fColor = lightTable.futureColor || { r: 59, g: 130, b: 246 };
          const mode = lightTable.displayMode || (lightTable.colorMode === 'tinted' ? 'monochrome' : 'color');

          for (let i = 0; i < frameImg.data.length; i += 4) {
            const a = frameImg.data[i + 3];
            if (a > 0) {
              if (mode === 'monochrome') {
                const lum = (0.299 * frameImg.data[i] + 0.587 * frameImg.data[i + 1] + 0.114 * frameImg.data[i + 2]) / 255;
                frameImgData.data[i] = Math.round(lum * fColor.r);
                frameImgData.data[i + 1] = Math.round(lum * fColor.g);
                frameImgData.data[i + 2] = Math.round(lum * fColor.b);
                frameImgData.data[i + 3] = a;
              } else if (mode === 'half-color') {
                frameImgData.data[i] = Math.round((frameImg.data[i] + fColor.r) / 2);
                frameImgData.data[i + 1] = Math.round((frameImg.data[i + 1] + fColor.g) / 2);
                frameImgData.data[i + 2] = Math.round((frameImg.data[i + 2] + fColor.b) / 2);
                frameImgData.data[i + 3] = a;
              } else {
                frameImgData.data[i] = frameImg.data[i];
                frameImgData.data[i + 1] = frameImg.data[i + 1];
                frameImgData.data[i + 2] = frameImg.data[i + 2];
                frameImgData.data[i + 3] = a;
              }
            }
          }

          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = frameImg.width;
          tempCanvas.height = frameImg.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            tempCtx.putImageData(frameImgData, 0, 0);
            ctx.globalAlpha = frameAlpha;
            ctx.drawImage(tempCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
          }
        }
      }

      // 1.5 Draw Individual Light Table SubLayers (登録された個別の参照TGA: 移動・回転アフィン変換)
      if (isLeft && lightTable.items && lightTable.items.length > 0) {
        for (const subItem of lightTable.items) {
          if (!subItem.visible || !subItem.image) continue;

          const subImg = subItem.image;
          const subCanvas = document.createElement('canvas');
          subCanvas.width = subImg.width;
          subCanvas.height = subImg.height;
          const subCtx = subCanvas.getContext('2d');

          if (subCtx) {
            const imgData = subCtx.createImageData(subImg.width, subImg.height);
            imgData.data.set(subImg.data);
            subCtx.putImageData(imgData, 0, 0);

            ctx.save();
            // サブレイヤー位置オフセット & 回転中心移動
            ctx.translate(canvas.width / 2 + subItem.offsetX, canvas.height / 2 + subItem.offsetY);
            ctx.rotate((subItem.rotation * Math.PI) / 180);
            ctx.translate(-subImg.width / 2, -subImg.height / 2);

            ctx.globalAlpha = subItem.opacity / 100;
            ctx.drawImage(subCanvas, 0, 0);
            ctx.restore();
          }
        }
      }

      // 2. Draw Target Image (スタビライザー アフィン変換適用)
      const imgData = ctx.createImageData(targetImg.width, targetImg.height);
      imgData.data.set(targetImg.data);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = targetImg.width;
      tempCanvas.height = targetImg.height;
      const tempCtx = tempCanvas.getContext('2d');

      if (tempCtx) {
        tempCtx.putImageData(imgData, 0, 0);

        ctx.save();
        if (pegStabilizer.enabled) {
          const totalX = pegStabilizer.offsetX + pegStabilizer.manualX;
          const totalY = pegStabilizer.offsetY + pegStabilizer.manualY;
          const totalRot = (pegStabilizer.rotation + pegStabilizer.manualRotation) * (Math.PI / 180);

          ctx.translate(canvas.width / 2 + totalX, canvas.height / 2 + totalY);
          ctx.rotate(totalRot);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);
        }

        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
      }

      // 3. Grid Overlay
      if (showGrid) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 1;
        const gridSize = 32;
        for (let x = 0; x <= canvas.width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y <= canvas.height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      // 4. 理想タップ穴ガイドオーバーレイ (Peg Guide)
      if (pegStabilizer.showGuide) {
        ctx.strokeStyle = '#EF4444'; // 赤アウトライン
        ctx.lineWidth = 2;
        const cx = canvas.width / 2;
        const cy = 50;

        // 中央長円
        ctx.beginPath();
        ctx.ellipse(cx, cy, 14, 8, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 左右正円
        ctx.beginPath();
        ctx.arc(cx - 140, cy, 8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx + 140, cy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 5. Lasso Preview
      if (isLeft && lassoPoints.length > 1) {
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for (let i = 1; i < lassoPoints.length; i++) {
          ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    [prevImage, nextImage, lightTable, isPlaying, showGrid, showUnpaintedFlash, lassoPoints, pegStabilizer]
  );

  useEffect(() => {
    renderCanvasInstance(leftCanvasRef.current, currentImage, true);
    if (isSplitView) {
      renderCanvasInstance(rightCanvasRef.current, splitImage, false);
    }
  }, [renderCanvasInstance, currentImage, splitImage, isSplitView, renderTrigger]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>, isLeftView: boolean) => {
    const viewIdx = isLeftView ? 0 : 1;
    setActiveViewIndex(viewIdx);

    const targetImg = isLeftView ? currentImage : splitImage;
    const canvas = isLeftView ? leftCanvasRef.current : rightCanvasRef.current;
    if (!targetImg || !canvas) return;

    const currentTransform = isLeftView ? canvasTransform : splitCanvasTransform;

    // ⚠️ 左クリック (0) (panツール/Spaceキー押下時), 中ボタン (1), 右ボタン (2) でパン移動
    if (
      e.button === 1 ||
      e.button === 2 ||
      (e.button === 0 && (activeTool === 'pan' || isSpacePressed))
    ) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - currentTransform.offsetX, y: e.clientY - currentTransform.offsetY });
      return;
    }

    const { x, y } = getCanvasCoords(e, canvas);

    // 閲覧専用（タイムシートや指示メモなどのJPG画像）の場合は塗り・描画操作をガード
    if (targetImg.isReadOnly && activeTool !== 'eyedropper' && e.button !== 1 && !e.altKey) {
      return;
    }

    if (activeTool === 'fill') {
      saveUndoState('バケツ塗り');
      floodFill(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y,
        currentColor,
        toolOptions
      );
      triggerRender();
    } else if (activeTool === 'gradient') {
      saveUndoState('グラデーション塗り');
      gradientFill(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y,
        currentColor,
        backgroundColor,
        toolOptions
      );
      triggerRender();
    } else if (activeTool === 'noiseEraser') {
      saveUndoState('ワンクリックゴミ取り');
      const removed = removeSingleNoiseAt(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y,
        toolOptions.maxNoiseSize * 10
      );
      if (removed) triggerRender();
    } else if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') {
      saveUndoState(activeTool === 'eraser' ? '消しゴム描画' : 'ペイント線描画');
      setIsBrushing(true);
      setLastPos({ x, y });
      drawBrushLine(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y, x, y,
        toolOptions.brushSize,
        currentColor,
        activeTool === 'eraser'
      );
      triggerRender();
    } else if (activeTool === 'eyedropper' || e.altKey) {
      const idx = (y * targetImg.width + x) * 4;
      const r = targetImg.data[idx];
      const g = targetImg.data[idx + 1];
      const b = targetImg.data[idx + 2];
      const a = targetImg.data[idx + 3];
      const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
      setCurrentColor({ r, g, b, a, hex });
    } else if (activeTool === 'closedFill' || activeTool === 'lasso') {
      saveUndoState('閉領域フィル');
      setIsLassoing(true);
      setLassoPoints([{ x, y }]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>, isLeftView: boolean) => {
    const targetImg = isLeftView ? currentImage : splitImage;
    const canvas = isLeftView ? leftCanvasRef.current : rightCanvasRef.current;
    const currentTransform = isLeftView ? canvasTransform : splitCanvasTransform;

    if (isPanning) {
      const newTransform = {
        ...currentTransform,
        offsetX: e.clientX - panStart.x,
        offsetY: e.clientY - panStart.y,
      };

      if (syncMode && isSplitView) {
        setCanvasTransform(newTransform);
        setSplitCanvasTransform(newTransform);
      } else {
        if (isLeftView) setCanvasTransform(newTransform);
        else setSplitCanvasTransform(newTransform);
      }
      return;
    }

    if (!targetImg || !canvas) return;
    const { x, y } = getCanvasCoords(e, canvas);

    if (isBrushing && lastPos) {
      drawBrushLine(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        lastPos.x, lastPos.y, x, y,
        toolOptions.brushSize,
        currentColor,
        activeTool === 'eraser'
      );
      setLastPos({ x, y });
      triggerRender();
    } else if (isLassoing) {
      setLassoPoints((prev) => [...prev, { x, y }]);
      triggerRender();
    }
  };

  const handleMouseUp = (isLeftView: boolean) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isBrushing) {
      setIsBrushing(false);
      setLastPos(null);
    }

    const targetImg = isLeftView ? currentImage : splitImage;
    if (isLassoing && targetImg) {
      setIsLassoing(false);
      if (lassoPoints.length > 2) {
        closedAreaFill(
          targetImg.data,
          targetImg.width,
          targetImg.height,
          lassoPoints,
          currentColor,
          toolOptions
        );
        triggerRender();
      }
      setLassoPoints([]);
    }
  };

  const handleWheel = (e: React.WheelEvent, isLeftView: boolean) => {
    e.preventDefault();
    const currentTransform = isLeftView ? canvasTransform : splitCanvasTransform;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(0.2, currentTransform.scale * zoomFactor), 5.0);
    const newTransform = { ...currentTransform, scale: newScale };

    if (syncMode && isSplitView) {
      setCanvasTransform(newTransform);
      setSplitCanvasTransform(newTransform);
    } else {
      if (isLeftView) setCanvasTransform(newTransform);
      else setSplitCanvasTransform(newTransform);
    }
  };

  const isDockedReference = referenceCanvas.isOpen && !referenceCanvas.isFloating;
  const isHorizontalSplit = isDockedReference && colorSpecLayoutMode === 'split-horizontal';

  return (
    <div
      ref={containerRef}
      id="main-workspace-area"
      className={`flex-1 flex flex-col relative overflow-hidden select-none transition-colors ${
        canvasBgMatteMode === 'checkerboard'
          ? 'checkerboard-pattern bg-slate-300 dark:bg-slate-950'
          : canvasBgMatteMode === 'black'
          ? 'bg-black'
          : canvasBgMatteMode === 'white'
          ? 'bg-white'
          : canvasBgMatteMode === 'magenta'
          ? 'bg-[#ff00ff]'
          : ''
      }`}
      style={canvasBgMatteMode === 'custom' ? { backgroundColor: canvasCustomBgColor } : undefined}
    >
      {/* 隠しドッキング復帰吸着アンカー (参照画像ドッキング復帰用) */}
      <div id="docked-reference-tab" className="hidden" />

      {/* フローティング参照ウィンドウ */}
      {referenceCanvas.isOpen && referenceCanvas.isFloating && <ReferenceCanvasView isFloating={true} />}

      {/* セルキャンバス＆参照エリア (画面分割レイアウト) */}
      <div className={`flex-1 flex overflow-hidden p-0.5 gap-0.5 ${isHorizontalSplit ? 'flex-col' : 'flex-row'}`}>
        {/* メイン編集エリア (Win A / Win B 独立フローティング対応) */}
        <div className="flex-1 flex overflow-hidden gap-0.5 relative">
          {/* 左ビュー (Win A / Dir A) */}
          <div
            ref={winADrag.targetRef}
            style={isWinAFloating ? { position: 'fixed', top: 0, left: 0, zIndex: 50 } : undefined}
            onClick={() => setActiveViewIndex(0)}
            onDragOver={(e) => {
              e.preventDefault();
              setIsWinADragOver(true);
            }}
            onDragLeave={() => setIsWinADragOver(false)}
            onDrop={(e) => handleFolderOrFilesNativeDrop(e, 'winA')}
            className={`flex flex-col overflow-hidden border-2 ${
              isWinADragOver
                ? 'border-blue-500 ring-4 ring-blue-500/50'
                : isWinAFloating
                ? 'w-[680px] h-[520px] bg-slate-100 dark:bg-slate-900 border-blue-600 shadow-2xl rounded relative'
                : `flex-1 relative rounded ${
                    activeViewIndex === 0 && isSplitView ? 'border-blue-600 dark:border-blue-500 shadow-md' : 'border-transparent'
                  }`
            }`}
          >
            {/* 📁 エクスプローラーダイレクト D&D 案内オーバーレイ */}
            {isWinADragOver && (
              <div className="absolute inset-0 bg-blue-950/90 backdrop-blur-xs border-2 border-dashed border-blue-300 rounded flex flex-col items-center justify-center text-blue-200 z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none">
                <FolderOpen className="w-10 h-10 mb-2 animate-bounce text-blue-400" />
                <span className="font-bold text-sm text-white">ここにフォルダをドロップして Win A で開く</span>
                <span className="text-[10px] opacity-80 mt-1">エクスプローラーからダイレクトにフォルダを開けます</span>
              </div>
            )}

            {/* Win A タイトルバー (Tear-off & Docking 対応) */}
            <div
              id={isWinAFloating ? undefined : 'docked-winA-tab'}
              onPointerDown={(e) => handleGenericHeaderPointerDown(e, 'winA', isWinAFloating, winADrag.currentPos, winADrag.setPosition)}
              className="h-6 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[11px] justify-between select-none touch-none cursor-grab active:cursor-grabbing"
            >
              <span className="font-semibold text-blue-600 dark:text-blue-400 truncate flex items-center gap-1.5">
                <span>Win A ({folderNameA || 'Orig'}): {unifiedFileList[currentFileIndex] || '0001.tga'}</span>
                {currentImage?.isReadOnly && (
                  <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded shadow-xs">
                    🔒 閲覧専用 (Sheet View)
                  </span>
                )}
              </span>

              <div className="flex items-center gap-1">
                {!currentImage && (
                  <span className="text-[9px] text-red-500 font-bold flex items-center gap-1 mr-1">
                    <AlertTriangle className="w-3 h-3" /> NO DATA
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWinAFloating();
                  }}
                  title={isWinAFloating ? 'ドッキングに戻す' : '切り離して独立表示 (Tear-off)'}
                  className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-600 dark:text-slate-300"
                >
                  {isWinAFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {showRuler && currentImage && (
              <div className="h-3.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[8px] font-mono text-slate-500 dark:text-slate-400 justify-between select-none">
                <span>0px</span>
                <span>{Math.floor(currentImage.width / 2)}px</span>
                <span>{currentImage.width}px</span>
              </div>
            )}

            <div
              className={`flex-1 bg-slate-300 dark:bg-slate-950 relative flex items-center justify-center overflow-hidden transition-colors ${
                activeTool === 'pan' || isSpacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
              }`}
              onWheel={(e) => handleWheel(e, true)}
            >
              <div
                style={{
                  transform: `translate(${canvasTransform.offsetX}px, ${canvasTransform.offsetY}px) scale(${canvasTransform.scale})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.05s ease-out',
                }}
                className="shadow-2xl border border-slate-400 dark:border-slate-700 bg-white relative"
              >
                <canvas
                  ref={leftCanvasRef}
                  onMouseDown={(e) => handleMouseDown(e, true)}
                  onMouseMove={(e) => handleMouseMove(e, true)}
                  onMouseUp={() => handleMouseUp(true)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="block"
                />

                {!currentImage && (
                  <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-900/10 dark:bg-slate-950/20 backdrop-blur-[1px] pointer-events-none">
                    <div className="flex flex-col items-center justify-center p-5 text-center bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl max-w-sm pointer-events-auto select-none animate-in fade-in duration-150">
                      <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center mb-2.5 text-blue-600 dark:text-blue-400">
                        <FolderOpen className="w-5 h-5" />
                      </div>
                      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">NO CELL DATA</h3>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2.5 leading-relaxed">
                        エクスプローラーやFinderから TGAファイルが入ったフォルダを開いてセル画像を選択してください
                      </p>
                      <span className="text-[9px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                        ファイル &gt; フォルダを開く (Ctrl+Shift+O) または 右パネル Open A
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右ビュー (Win B / Dir B / Split View 有効時) */}
          {isSplitView && (
            <div
              ref={winBDrag.targetRef}
              style={isWinBFloating ? { position: 'fixed', top: 0, left: 0, zIndex: 50 } : undefined}
              onClick={() => setActiveViewIndex(1)}
              onDragOver={(e) => {
                e.preventDefault();
                setIsWinBDragOver(true);
              }}
              onDragLeave={() => setIsWinBDragOver(false)}
              onDrop={(e) => handleFolderOrFilesNativeDrop(e, 'winB')}
              className={`flex flex-col overflow-hidden border-2 ${
                isWinBDragOver
                  ? 'border-emerald-500 ring-4 ring-emerald-500/50'
                  : isWinBFloating
                  ? 'w-[680px] h-[520px] bg-slate-100 dark:bg-slate-900 border-emerald-600 shadow-2xl rounded relative'
                  : `flex-1 relative rounded ${
                      activeViewIndex === 1 ? 'border-blue-600 dark:border-blue-500 shadow-md' : 'border-transparent'
                    }`
              }`}
            >
              {/* 📁 エクスプローラーダイレクト D&D 案内オーバーレイ */}
              {isWinBDragOver && (
                <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-xs border-2 border-dashed border-emerald-300 rounded flex flex-col items-center justify-center text-emerald-200 z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none">
                  <FolderOpen className="w-10 h-10 mb-2 animate-bounce text-emerald-400" />
                  <span className="font-bold text-sm text-white">ここにフォルダをドロップして Win B で開く</span>
                  <span className="text-[10px] opacity-80 mt-1">エクスプローラーからダイレクトにフォルダを開けます</span>
                </div>
              )}

              {/* Win B タイトルバー (Tear-off & Docking 対応) */}
              <div
                id={isWinBFloating ? undefined : 'docked-winB-tab'}
                onPointerDown={(e) => handleGenericHeaderPointerDown(e, 'winB', isWinBFloating, winBDrag.currentPos, winBDrag.setPosition)}
                className="h-6 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-2 text-[11px] select-none touch-none cursor-grab active:cursor-grabbing"
              >
                <span className="font-semibold text-slate-700 dark:text-slate-300 truncate flex items-center gap-1.5">
                  <span>Win B ({folderNameB || 'Retake'}): {unifiedFileList[splitFileIndex] || '0001.tga'}</span>
                  {splitImage?.isReadOnly && (
                    <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded shadow-xs">
                      🔒 閲覧専用 (Sheet View)
                    </span>
                  )}
                </span>

                <div className="flex items-center gap-1">
                  {!splitImage && (
                    <span className="text-[9px] text-red-500 font-bold flex items-center gap-1 mr-1">
                      <AlertTriangle className="w-3 h-3" /> NO DATA
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWinBFloating();
                    }}
                    title={isWinBFloating ? 'ドッキングに戻す' : '切り離して独立表示 (Tear-off)'}
                    className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-600 dark:text-slate-300"
                  >
                    {isWinBFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              {showRuler && splitImage && (
                <div className="h-3.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[8px] font-mono text-slate-500 dark:text-slate-400 justify-between select-none">
                  <span>0px</span>
                  <span>{Math.floor(splitImage.width / 2)}px</span>
                  <span>{splitImage.width}px</span>
                </div>
              )}

              <div
                className={`flex-1 bg-slate-300 dark:bg-slate-950 relative flex items-center justify-center overflow-hidden transition-colors ${
                  activeTool === 'pan' || isSpacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
                }`}
                onWheel={(e) => handleWheel(e, false)}
              >
                <div
                  style={{
                    transform: `translate(${splitCanvasTransform.offsetX}px, ${splitCanvasTransform.offsetY}px) scale(${splitCanvasTransform.scale})`,
                    transformOrigin: 'center center',
                    transition: isPanning ? 'none' : 'transform 0.05s ease-out',
                  }}
                  className="shadow-2xl border border-slate-400 dark:border-slate-700 bg-white relative"
                >
                  <canvas
                    ref={rightCanvasRef}
                    onMouseDown={(e) => handleMouseDown(e, false)}
                    onMouseMove={(e) => handleMouseMove(e, false)}
                    onMouseUp={() => handleMouseUp(false)}
                    onContextMenu={(e) => e.preventDefault()}
                    className="block"
                  />

                  {!splitImage && (
                    <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-900/10 dark:bg-slate-950/20 backdrop-blur-[1px] pointer-events-none">
                      <div className="flex flex-col items-center justify-center p-5 text-center bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl max-w-sm pointer-events-auto select-none animate-in fade-in duration-150">
                        <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mb-2.5 text-emerald-600 dark:text-emerald-400">
                          <FolderOpen className="w-5 h-5" />
                        </div>
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">NO RETAKE DATA</h3>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2.5 leading-relaxed">
                          リテイク用（Dir B）フォルダを開いて比較セル画像を表示してください
                        </p>
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                          右パネル Open B からリテイクフォルダを選択
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ドッキング参照ウィンドウ (分割表示時) ＆ ドッキングターゲット領域 */}
        {referenceCanvas.isOpen && (
          <div
            id="docked-reference-area"
            className={referenceCanvas.isFloating ? 'hidden' : 'flex-1 flex flex-col min-w-[240px]'}
          >
            <ReferenceCanvasView isFloating={false} />
          </div>
        )}
      </div>
    </div>
  );
};
