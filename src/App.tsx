import React, { useEffect } from 'react';
import { MenuBar } from './components/layout/MenuBar';
import { ToolPalette } from './components/panels/ToolPalette';
import { ToolOptions } from './components/panels/ToolOptions';
import { CellWindow } from './components/panels/CellWindow';
import { LightTable } from './components/panels/LightTable';
import { FileBrowser } from './components/panels/FileBrowser';
import { ColorChart } from './components/panels/ColorChart';
import { LayerPanel } from './components/panels/LayerPanel';
import { HistoryPanel } from './components/panels/HistoryPanel';
import { AboutModal } from './components/modals/AboutModal';
import { ShortcutsModal } from './components/modals/ShortcutsModal';
import { PreferencesModal } from './components/modals/PreferencesModal';
import { ReplaceColorModal } from './components/modals/ReplaceColorModal';
import { usePaintStore } from './store/usePaintStore';
import { encodeTGA } from './engine/tga';

export const App: React.FC = () => {
  const {
    isDarkMode,
    nextCell,
    prevCell,
    currentImage,
    fileList,
    currentFileIndex,
    folderHandle,
    toolOptions,
    setGapCloseLevel,
    setEnableIncludeTrace,
    undo,
    redo,
    panelVisibility,
    togglePanelVisibility,
    setActiveModal,
  } = usePaintStore();

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDarkMode]);

  // キーボードショートカット & ハンドラー
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // F5 - F9: Panel visibility toggles
      if (e.key === 'F5') { e.preventDefault(); togglePanelVisibility('toolPalette'); }
      else if (e.key === 'F6') { e.preventDefault(); togglePanelVisibility('toolOptions'); }
      else if (e.key === 'F7') { e.preventDefault(); togglePanelVisibility('colorChart'); }
      else if (e.key === 'F8') { e.preventDefault(); togglePanelVisibility('lightTable'); }
      else if (e.key === 'F9') { e.preventDefault(); togglePanelVisibility('fileBrowser'); }

      // Ctrl + K (Preferences)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveModal('preferences');
      }
      // Ctrl + H (Replace Color)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setActiveModal('replaceColor');
      }
      // Ctrl + Z (Undo) / Ctrl + Y or Ctrl + Shift + Z (Redo)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
      // Ctrl + S (Save TGA)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (currentImage && folderHandle && fileList[currentFileIndex]) {
          try {
            const fileName = fileList[currentFileIndex];
            const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            const buffer = encodeTGA(currentImage);
            await writable.write(buffer);
            await writable.close();
            console.log(`Saved ${fileName} successfully.`);
          } catch (err) {
            console.error('Failed to save file directly to disk:', err);
          }
        }
      }
      // PageDown / Down Arrow
      else if (e.key === 'PageDown' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextCell();
      }
      // PageUp / Up Arrow
      else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
        e.preventDefault();
        prevCell();
      }
      // T key: Toggle Include Trace
      else if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.altKey) {
        setEnableIncludeTrace(!toolOptions.enableIncludeTrace);
      }
      // [ / ] keys: Gap close adjustment
      else if (e.key === '[') {
        setGapCloseLevel(Math.max(0, toolOptions.gapCloseLevel - 1));
      } else if (e.key === ']') {
        setGapCloseLevel(Math.min(10, toolOptions.gapCloseLevel + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    nextCell,
    prevCell,
    currentImage,
    fileList,
    currentFileIndex,
    folderHandle,
    toolOptions,
    setGapCloseLevel,
    setEnableIncludeTrace,
    undo,
    redo,
    togglePanelVisibility,
    setActiveModal,
  ]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 transition-colors duration-150">
      {/* Top Menu Bar */}
      <MenuBar />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex p-1 gap-1 h-[calc(100vh-32px)]">
        {/* Left: Tool Palette */}
        {panelVisibility.toolPalette && <ToolPalette />}

        {/* Center: Tool Options + Cell Window + Light Table */}
        <div className="flex-1 flex flex-col gap-1 overflow-hidden">
          {panelVisibility.toolOptions && <ToolOptions />}
          <CellWindow />
          {panelVisibility.lightTable && <LightTable />}
        </div>

        {/* Right: File Browser + Layer Panel + History Panel + Color Chart */}
        {(panelVisibility.fileBrowser || panelVisibility.colorChart || panelVisibility.layerPanel || panelVisibility.historyPanel) && (
          <div className="w-64 flex flex-col gap-1 overflow-hidden">
            {panelVisibility.fileBrowser && <FileBrowser />}
            {panelVisibility.layerPanel && <LayerPanel />}
            {panelVisibility.historyPanel && <HistoryPanel />}
            {panelVisibility.colorChart && <ColorChart />}
          </div>
        )}
      </div>

      {/* Modals */}
      <AboutModal />
      <ShortcutsModal />
      <PreferencesModal />
      <ReplaceColorModal />
    </div>
  );
};

export default App;
