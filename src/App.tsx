import React, { useEffect } from 'react';
import { usePaintStore } from './store/usePaintStore';
import { MenuBar } from './components/layout/MenuBar';
import { ToolPalette } from './components/panels/ToolPalette';
import { ToolOptions } from './components/panels/ToolOptions';
import { CellWindow } from './components/panels/CellWindow';
import { ColorChart } from './components/panels/ColorChart';
import { LightTable } from './components/panels/LightTable';
import { FileBrowser } from './components/panels/FileBrowser';
import { LayerPanel } from './components/panels/LayerPanel';
import { HistoryPanel } from './components/panels/HistoryPanel';
import { AboutModal } from './components/modals/AboutModal';
import { PreferencesModal } from './components/modals/PreferencesModal';
import { ShortcutsModal } from './components/modals/ShortcutsModal';
import { ReplaceColorModal } from './components/modals/ReplaceColorModal';
import { MobileGuard } from './components/common/MobileGuard';

export const App: React.FC = () => {
  const {
    isDarkMode,
    panelVisibility,
    nextCell,
    prevCell,
    undo,
    redo,
    setActiveTool,
    setActivePaletteTab,
  } = usePaintStore();

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // グローバルショートカット (PageDown/Up, Undo/Redo, 1/2/3キーでのパレットタブ切替)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // テキスト入力中は短縮キーをスルー
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.key === 'F1') {
        e.preventDefault();
        window.open('/Kingfisher_Manual.html', '_blank');
      } else if (e.key === 'PageDown' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextCell();
      } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
        e.preventDefault();
        prevCell();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === '1') {
        setActivePaletteTab('normal');
      } else if (e.key === '2') {
        setActivePaletteTab('shadow');
      } else if (e.key === '3') {
        setActivePaletteTab('highlight');
      } else if (e.key.toLowerCase() === 'f') {
        setActiveTool('fill');
      } else if (e.key.toLowerCase() === 'g') {
        setActiveTool('gradient');
      } else if (e.key.toLowerCase() === 'b') {
        setActiveTool('brush');
      } else if (e.key.toLowerCase() === 'p') {
        setActiveTool('pencil');
      } else if (e.key.toLowerCase() === 'e') {
        setActiveTool('eraser');
      } else if (e.key.toLowerCase() === 'n') {
        setActiveTool('noiseEraser');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextCell, prevCell, undo, redo, setActiveTool, setActivePaletteTab]);

  const [rightSidebarWidth, setRightSidebarWidth] = React.useState<number>(320);
  const isRightResizing = React.useRef(false);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(320);

  const handleRightResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isRightResizing.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = rightSidebarWidth;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  const handleRightResizeMove = (e: React.PointerEvent) => {
    if (!isRightResizing.current) return;
    const deltaX = startXRef.current - e.clientX;
    const newWidth = Math.min(600, Math.max(180, startWidthRef.current + deltaX));
    setRightSidebarWidth(newWidth);
  };

  const handleRightResizeUp = (e: React.PointerEvent) => {
    if (!isRightResizing.current) return;
    isRightResizing.current = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-200 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans select-none transition-colors duration-150">
      {/* 1. Top Menu Bar */}
      <MenuBar />

      {/* 2. Main Workspace Layout (Zero-Margin Edge-to-Edge) */}
      <div className="flex-1 flex p-0 gap-0 overflow-hidden">
        {/* Left: Tool Palette */}
        {panelVisibility.toolPalette && <ToolPalette />}

        {/* Center Main Column */}
        <div className="flex-1 flex flex-col gap-0 overflow-hidden">
          {/* Top: Tool Options Bar */}
          {panelVisibility.toolOptions && <ToolOptions />}

          {/* Canvas Window Area */}
          <CellWindow />

          {/* Bottom: Light Table & Animation Bar */}
          {panelVisibility.lightTable && <LightTable />}
        </div>

        {/* Right Docking Panels Column (Resizable) */}
        <div
          style={{ width: `${rightSidebarWidth}px` }}
          className="flex flex-col gap-0 overflow-hidden border-l border-slate-300 dark:border-slate-800 relative flex-shrink-0"
        >
          {/* 左端ドラッグリサイズハンドルバー (境界線をつかんで幅調整) */}
          <div
            onPointerDown={handleRightResizeDown}
            onPointerMove={handleRightResizeMove}
            onPointerUp={handleRightResizeUp}
            onPointerCancel={handleRightResizeUp}
            title="ドラッグで右サイドパネルの幅を調整 (180px 〜 600px)"
            className="absolute top-0 left-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-600 z-30 transition-colors touch-none"
          />

          {/* File Browser */}
          {panelVisibility.fileBrowser && <FileBrowser />}

          {/* Color Chart */}
          {panelVisibility.colorChart && <ColorChart />}

          {/* Layer Panel */}
          {panelVisibility.layerPanel && <LayerPanel />}

          {/* History Panel */}
          {panelVisibility.historyPanel && <HistoryPanel />}
        </div>
      </div>

      {/* Modals & Guards */}
      <AboutModal />
      <PreferencesModal />
      <ShortcutsModal />
      <ReplaceColorModal />
      <MobileGuard />
    </div>
  );
};

export default App;
