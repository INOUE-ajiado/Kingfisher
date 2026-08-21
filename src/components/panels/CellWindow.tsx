import React, { useRef, useEffect, useState, useCallback } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { floodFill, gradientFill, closedAreaFill, drawBrushLine, removeSingleNoiseAt } from '../../engine/paintAlgorithm';
import { generateSampleTGA } from '../../engine/sampleGenerator';
import { decodeTGA } from '../../engine/tga';
import { Columns2, Link, Link2Off } from 'lucide-react';

export const CellWindow: React.FC = () => {
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const {
    fileList,
    currentFileIndex,
    splitFileIndex,
    setSplitFileIndex,
    isSplitView,
    toggleIsSplitView,
    syncMode,
    toggleSyncMode,
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
    folderHandle,
    saveUndoState,
    isPlaying,
    showGrid,
    showRuler,
    showUnpaintedFlash,
  } = usePaintStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);
  const [isLassoing, setIsLassoing] = useState(false);
  const [isBrushing, setIsBrushing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);

  const [splitImage, setSplitImage] = useState<any>(null);

  // メイン画像の読み込み
  useEffect(() => {
    let isSubscribed = true;

    async function loadImage() {
      const currentFileName = fileList[currentFileIndex];

      if (folderHandle && currentFileName) {
        try {
          const fileHandle = await folderHandle.getFileHandle(currentFileName);
          const file = await fileHandle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          const decoded = decodeTGA(arrayBuffer);
          if (isSubscribed) setCurrentImage(decoded);
        } catch (e) {
          console.warn('Failed to load local TGA file via handle, fallback to sample generator', e);
          if (isSubscribed) setCurrentImage(generateSampleTGA(currentFileIndex + 1));
        }
      } else {
        if (isSubscribed) {
          setCurrentImage(generateSampleTGA(currentFileIndex + 1));
          const prev = currentFileIndex > 0 ? generateSampleTGA(currentFileIndex) : null;
          const next = currentFileIndex < fileList.length - 1 ? generateSampleTGA(currentFileIndex + 2) : null;
          setPrevNextImages(prev, next);
        }
      }
    }

    loadImage();
    return () => { isSubscribed = false; };
  }, [currentFileIndex, fileList, folderHandle, setCurrentImage, setPrevNextImages]);

  // 分割右側ビュー画像の読み込み
  useEffect(() => {
    if (!isSplitView) return;
    let isSubscribed = true;

    async function loadSplitImage() {
      const splitFileName = fileList[splitFileIndex];
      if (folderHandle && splitFileName) {
        try {
          const fileHandle = await folderHandle.getFileHandle(splitFileName);
          const file = await fileHandle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          const decoded = decodeTGA(arrayBuffer);
          if (isSubscribed) setSplitImage(decoded);
        } catch (e) {
          if (isSubscribed) setSplitImage(generateSampleTGA(splitFileIndex + 1));
        }
      } else {
        if (isSubscribed) setSplitImage(generateSampleTGA(splitFileIndex + 1));
      }
    }

    loadSplitImage();
    return () => { isSubscribed = false; };
  }, [isSplitView, splitFileIndex, fileList, folderHandle]);

  // アニメーション再生
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const { currentFileIndex, fileList, setCurrentFileIndex } = usePaintStore.getState();
      const nextIdx = (currentFileIndex + 1) % fileList.length;
      setCurrentFileIndex(nextIdx);
    }, (1000 / usePaintStore.getState().fps) * toolOptions.frameHold);

    return () => clearInterval(interval);
  }, [isPlaying, toolOptions.frameHold]);

  // キャンバス描画関数
  const renderCanvasInstance = useCallback(
    (canvas: HTMLCanvasElement | null, targetImg: any, isLeft: boolean) => {
      if (!canvas || !targetImg) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = targetImg.width;
      canvas.height = targetImg.height;

      ctx.fillStyle = showUnpaintedFlash ? '#FF007F' : '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (isLeft && lightTable.enabled && !isPlaying) {
        const alphaVal = lightTable.opacity / 100;
        if (prevImage) {
          const prevImgData = ctx.createImageData(prevImage.width, prevImage.height);
          for (let i = 0; i < prevImage.data.length; i += 4) {
            const a = prevImage.data[i + 3];
            if (a > 0) {
              if (lightTable.colorMode === 'tinted') {
                prevImgData.data[i] = 255;
                prevImgData.data[i + 1] = 50;
                prevImgData.data[i + 2] = 50;
                prevImgData.data[i + 3] = a;
              } else {
                prevImgData.data[i] = prevImage.data[i];
                prevImgData.data[i + 1] = prevImage.data[i + 1];
                prevImgData.data[i + 2] = prevImage.data[i + 2];
                prevImgData.data[i + 3] = a;
              }
            }
          }
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = prevImage.width;
          tempCanvas.height = prevImage.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            tempCtx.putImageData(prevImgData, 0, 0);
            ctx.globalAlpha = alphaVal;
            ctx.drawImage(tempCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
          }
        }

        if (nextImage && lightTable.colorMode === 'tinted') {
          const nextImgData = ctx.createImageData(nextImage.width, nextImage.height);
          for (let i = 0; i < nextImage.data.length; i += 4) {
            const a = nextImage.data[i + 3];
            if (a > 0) {
              nextImgData.data[i] = 50;
              nextImgData.data[i + 1] = 100;
              nextImgData.data[i + 2] = 255;
              nextImgData.data[i + 3] = a;
            }
          }
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = nextImage.width;
          tempCanvas.height = nextImage.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            tempCtx.putImageData(nextImgData, 0, 0);
            ctx.globalAlpha = alphaVal * 0.7;
            ctx.drawImage(tempCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
          }
        }
      }

      const imgData = ctx.createImageData(targetImg.width, targetImg.height);
      imgData.data.set(targetImg.data);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = targetImg.width;
      tempCanvas.height = targetImg.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
      }

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
    [prevImage, nextImage, lightTable, isPlaying, showGrid, showUnpaintedFlash, lassoPoints]
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

    if (e.button === 1 || activeTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - currentTransform.offsetX, y: e.clientY - currentTransform.offsetY });
      return;
    }

    const { x, y } = getCanvasCoords(e, canvas);

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

  return (
    <div className="flex-1 bg-slate-300 dark:bg-slate-950 rounded border border-slate-300 dark:border-slate-800 flex flex-col relative overflow-hidden shadow-inner select-none transition-colors duration-150">
      {/* 画面分割・連動コントロール ヘッダーバー */}
      <div className="h-7 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-2 text-xs">
        <div className="flex items-center gap-2">
          {/* 1画面 / 2画面分割切り替えボタン */}
          <button
            onClick={toggleIsSplitView}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1 transition-colors ${
              isSplitView
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span>{isSplitView ? '2画面分割中' : '1画面表示'}</span>
          </button>

          {/* 左右連動 (Sync Mode) 切り替えボタン */}
          {isSplitView && (
            <button
              onClick={toggleSyncMode}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1 transition-colors ${
                syncMode
                  ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400'
              }`}
            >
              {syncMode ? <Link className="w-3.5 h-3.5" /> : <Link2Off className="w-3.5 h-3.5" />}
              <span>{syncMode ? '左右連動 (ON)' : '連動OFF'}</span>
            </button>
          )}
        </div>

        {/* ズーム倍率表示 */}
        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
          Zoom: {Math.round(canvasTransform.scale * 100)}%
        </div>
      </div>

      {/* セルキャンバス領域 (1画面または2画面) */}
      <div className="flex-1 flex overflow-hidden p-0.5 gap-0.5">
        {/* 左ビュー / メインビュー */}
        <div
          onClick={() => setActiveViewIndex(0)}
          className={`flex-1 flex flex-col relative overflow-hidden border-2 rounded ${
            activeViewIndex === 0 && isSplitView ? 'border-blue-600 dark:border-blue-500 shadow-md' : 'border-transparent'
          }`}
        >
          {/* 左タブ */}
          <div className="h-6 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[11px]">
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              View 1: {fileList[currentFileIndex] || '0001.tga'} *
            </span>
          </div>

          {showRuler && currentImage && (
            <div className="h-3.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[8px] font-mono text-slate-500 dark:text-slate-400 justify-between select-none">
              <span>0px</span>
              <span>{Math.floor(currentImage.width / 2)}px</span>
              <span>{currentImage.width}px</span>
            </div>
          )}

          <div
            className="flex-1 bg-slate-300 dark:bg-slate-950 relative flex items-center justify-center overflow-hidden cursor-crosshair"
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
                className="block"
              />
            </div>
          </div>
        </div>

        {/* 右ビュー (Split View 有効時) */}
        {isSplitView && (
          <div
            onClick={() => setActiveViewIndex(1)}
            className={`flex-1 flex flex-col relative overflow-hidden border-2 rounded ${
              activeViewIndex === 1 ? 'border-blue-600 dark:border-blue-500 shadow-md' : 'border-transparent'
            }`}
          >
            {/* 右タブ */}
            <div className="h-6 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-2 text-[11px]">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                View 2: {fileList[splitFileIndex] || '0001.tga'}
              </span>
              <select
                value={splitFileIndex}
                onChange={(e) => setSplitFileIndex(Number(e.target.value))}
                className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-[10px] px-1"
              >
                {fileList.map((f, idx) => (
                  <option key={f} value={idx}>{f}</option>
                ))}
              </select>
            </div>

            {showRuler && splitImage && (
              <div className="h-3.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[8px] font-mono text-slate-500 dark:text-slate-400 justify-between select-none">
                <span>0px</span>
                <span>{Math.floor(splitImage.width / 2)}px</span>
                <span>{splitImage.width}px</span>
              </div>
            )}

            <div
              className="flex-1 bg-slate-300 dark:bg-slate-950 relative flex items-center justify-center overflow-hidden cursor-crosshair"
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
                  className="block"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
