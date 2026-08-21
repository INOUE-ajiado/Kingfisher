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

      if (e.key === 'PageDown') {
        e.preventDefault();
        nextCell();
      } else if (e.key === 'PageUp') {
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

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-200 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans select-none transition-colors duration-150">
      {/* 1. Top Menu Bar */}
      <MenuBar />

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex p-1.5 gap-1.5 overflow-hidden">
        {/* Left: Tool Palette */}
        {panelVisibility.toolPalette && <ToolPalette />}

        {/* Center Main Column */}
        <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
          {/* Top: Tool Options Bar */}
          {panelVisibility.toolOptions && <ToolOptions />}

          {/* Canvas Window Area */}
          <CellWindow />

          {/* Bottom: Light Table & Animation Bar */}
          {panelVisibility.lightTable && <LightTable />}
        </div>

        {/* Right Docking Panels Column */}
        <div className="w-80 flex flex-col gap-1.5 overflow-hidden">
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

      {/* Modals */}
      <AboutModal />
      <PreferencesModal />
      <ShortcutsModal />
      <ReplaceColorModal />
    </div>
  );
};

export default App;
