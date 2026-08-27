import React, { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { usePaintStore } from './store/usePaintStore';
import { readDropItems, readDroppedFolder } from './engine/dropFolder';
import { sortNatural } from './engine/naturalOrder';
import { isPaneDrag } from './components/panels/PaneTabBar';
import { MenuBar } from './components/layout/MenuBar';
import { ToolPalette } from './components/panels/ToolPalette';
import { ToolOptionsPanel } from './components/panels/ToolOptionsPanel';
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
import { ExportVectorModal } from './components/modals/ExportVectorModal';
import { ExportTraceModal } from './components/modals/ExportTraceModal';
import { MobileGuard } from './components/common/MobileGuard';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

export const App: React.FC = () => {
  const {
    isDarkMode,
    panelVisibility,
    isRightSidebarOpen,
    toggleRightSidebarOpen,
  } = usePaintStore();

  // ⚡ 仕様書 (Kingfisher_Shortcut_Override_Specification.md) 準拠のグローバルオーバーライドフック
  useGlobalShortcuts();

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  /**
   * Ctrl+Alt (Mac は Cmd+Alt) で右パネルを一括開閉する。
   *
   * ⚠️ 修飾キーだけを見て発火させないこと。以前は押されたキーを一切見ておらず、
   * Ctrl+Alt を押している間はどのキーでもトグルしていた。キーリピートでも
   * 連打され、入力欄で打っている最中にも反応していた。
   * 組み合わせが成立した瞬間 (後から押した側の keydown) だけを拾う。
   * 押す順番はどちらでもよいので、両方の向きを見る。
   */
  useEffect(() => {
    const handleRightPanelShortcut = (e: KeyboardEvent) => {
      if (e.repeat) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const completesChord =
        (e.key === 'Alt' && (e.ctrlKey || e.metaKey)) ||
        ((e.key === 'Control' || e.key === 'Meta') && e.altKey);
      if (!completesChord) return;

      e.preventDefault();
      toggleRightSidebarOpen();
    };
    window.addEventListener('keydown', handleRightPanelShortcut);
    return () => window.removeEventListener('keydown', handleRightPanelShortcut);
  }, [toggleRightSidebarOpen]);

  /**
   * 画面のどこへ落としてもフォルダを開く。
   *
   * ⚠️ Win A / Win B / ロールの窓は自前のドロップ処理で stopPropagation しているので、
   * そこへ落とした分はここへ来ない。窓の外 (右パネルや余白) だけがここで拾われる。
   * ⚠️ タブの移動を拾わないこと。ファイルが 1 つも無いので開くものが無い。
   */
  const [isRootDragOver, setIsRootDragOver] = React.useState(false);

  const isFileDrag = (e: React.DragEvent) =>
    !!e.dataTransfer && Array.prototype.includes.call(e.dataTransfer.types, 'Files');

  const handleRootDragOver = (e: React.DragEvent) => {
    if (isPaneDrag(e.dataTransfer) || !isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsRootDragOver(true);
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setIsRootDragOver(false);
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    if (isPaneDrag(e.dataTransfer) || !isFileDrag(e)) return;
    e.preventDefault();
    setIsRootDragOver(false);

    const items = readDropItems(e.dataTransfer);
    const folder = await readDroppedFolder(items);

    const store = usePaintStore.getState();

    if (folder.images.size > 0) {
      // 隠していても、セルを開いたなら出す
      if (!store.isWinAVisible && store.activeViewIndex !== 1) store.toggleWinAVisible();
      // 画像は「今アクティブな方」へ。A/B を使い分けたいときは先にその窓を触ってから開く
      const files = sortNatural(folder.images.keys());
      const view = store.activeViewIndex === 1 ? 1 : 0;
      const name = folder.folderName || (view === 1 ? 'ドロップフォルダ B' : 'ドロップフォルダ A');

      if (folder.dirHandle) {
        // 書き込み可能なハンドルが取れた経路。保存もできる
        if (view === 1) store.setFolderHandleB(folder.dirHandle, name, files, folder.images);
        else store.setFolderHandleA(folder.dirHandle, name, files, folder.images);
      } else if (view === 1) {
        store.setCustomDropFolderB(name, folder.images, files);
      } else {
        store.setCustomDropFolderA(name, folder.images, files);
      }
    }

    if (folder.videos.length > 0) {
      // 一覧に載せるだけ。再生はツリーで選ばれてから
      store.setRollFolderFiles(folder.videos, folder.folderName);
      // 映像しか入っていなかったら、そのまま 1 本目を開く
      if (folder.images.size === 0) store.selectRollFile(store.roll.activeId, folder.videos[0].path);
    }

    if (folder.images.size === 0 && folder.videos.length === 0) {
      alert(
        'ドロップされた中に開けるファイルが見つかりませんでした。\n' +
          'セル画像 (.tga / .png / .jpg) と撮影ロール (.mov / .mp4) に対応しています。'
      );
    }
  };

  const [rightSidebarWidth, setRightSidebarWidth] = React.useState<number>(320);
  const isRightResizing = React.useRef(false);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(320);

  // パネル個別の縦幅 (高さ px) ステート
  const [panelHeights, setPanelHeights] = React.useState<Record<string, number>>({
    toolOptions: 100,
    fileBrowser: 480,
    colorChart: 260,
    layerPanel: 180,
    historyPanel: 160,
  });

  const activeResizingKeyRef = React.useRef<string | null>(null);
  const startYRef = React.useRef(0);
  const startHeightRef = React.useRef(0);

  const handleRowResizeDown = (key: string, currentHeight: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    activeResizingKeyRef.current = key;
    startYRef.current = e.clientY;
    startHeightRef.current = currentHeight;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  const handleRowResizeMove = (key: string, e: React.PointerEvent) => {
    if (activeResizingKeyRef.current !== key) return;
    const deltaY = e.clientY - startYRef.current;
    const newHeight = Math.max(60, startHeightRef.current + deltaY);
    setPanelHeights((prev) => ({
      ...prev,
      [key]: newHeight,
    }));
  };

  const handleRowResizeUp = (key: string, e: React.PointerEvent) => {
    if (activeResizingKeyRef.current !== key) return;
    activeResizingKeyRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}
  };

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
    <div
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      className="h-screen w-screen flex flex-col bg-slate-200 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans select-none transition-colors duration-150"
    >
      {isRootDragOver && (
        <div className="fixed inset-0 z-[100] pointer-events-none flex items-end justify-center pb-10">
          <div className="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-2xl border border-blue-400">
            ここへドロップするとフォルダを開きます (セル・映像をまとめて読み込みます)
          </div>
        </div>
      )}
      {/* 1. Top Menu Bar */}
      <MenuBar />

      {/* 2. Main Workspace Layout (Zero-Margin Edge-to-Edge) */}
      <div className="flex-1 flex p-0 gap-0 overflow-hidden">
        {/* Left: Tool Palette */}
        {panelVisibility.toolPalette && <ToolPalette />}

        {/* Center Main Column */}
        <div className="flex-1 flex flex-col gap-0 overflow-hidden">
          {/* Canvas Window Area */}
          <CellWindow />

          {/* Bottom: Light Table & Animation Bar */}
          {panelVisibility.lightTable && <LightTable />}
        </div>

          {/* Right Docking Panels Column (Toggleable via Ctrl+Alt / Ctrl+Cmd) */}
          {isRightSidebarOpen && (
            <div
              style={{ width: `${rightSidebarWidth}px` }}
              className="flex flex-col gap-0 overflow-hidden border-l border-slate-300 dark:border-slate-800 relative flex-shrink-0"
            >
              {/* 左端ドラッグリサイズハンドルバー (横幅調整) */}
              <div
                onPointerDown={handleRightResizeDown}
                onPointerMove={handleRightResizeMove}
                onPointerUp={handleRightResizeUp}
                onPointerCancel={handleRightResizeUp}
                title="ドラッグで右サイドパネルの幅を調整 (180px 〜 600px)"
                className="absolute top-0 left-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-600 z-30 transition-colors touch-none"
              />

              {/* 1. 最上位固定: ファイルツリー (File Browser) */}
              {panelVisibility.fileBrowser && (
                <React.Fragment>
                  <div
                    style={{ height: `${panelHeights.fileBrowser || 480}px` }}
                    className="flex flex-col overflow-hidden flex-shrink-0"
                  >
                    <FileBrowser />
                  </div>

                  {/* ファイルツリーと下部パネルとの間のドラッグリサイズハンドル */}
                  <div
                    onPointerDown={(e) => handleRowResizeDown('fileBrowser', panelHeights.fileBrowser || 480, e)}
                    onPointerMove={(e) => handleRowResizeMove('fileBrowser', e)}
                    onPointerUp={(e) => handleRowResizeUp('fileBrowser', e)}
                    onPointerCancel={(e) => handleRowResizeUp('fileBrowser', e)}
                    title="ドラッグでファイルツリーの縦幅を調整"
                    className="h-1.5 cursor-row-resize hover:bg-blue-500/80 active:bg-blue-600 bg-slate-300 dark:bg-slate-800 transition-colors z-20 touch-none flex-shrink-0 border-y border-slate-300/50 dark:border-slate-700/50"
                  />
                </React.Fragment>
              )}

              {/* 2. 下部パネル群エリア (ツールオプション / ColorChart / レイヤー / 履歴): スクロールバー非表示で独立縦スクロール */}
              <div className="flex-1 flex flex-col gap-0 overflow-y-auto no-scrollbar">
                {(() => {
                  const lowerPanels = [
                    { key: 'toolOptions', visible: panelVisibility.toolOptions, component: <ToolOptionsPanel /> },
                    { key: 'colorChart', visible: panelVisibility.colorChart, component: <ColorChart /> },
                    { key: 'layerPanel', visible: panelVisibility.layerPanel, component: <LayerPanel /> },
                    { key: 'historyPanel', visible: panelVisibility.historyPanel, component: <HistoryPanel /> },
                  ].filter((p) => p.visible);

                  return lowerPanels.map((panel, idx) => {
                    const isLast = idx === lowerPanels.length - 1;
                    const h = panelHeights[panel.key] || 200;

                    return (
                      <React.Fragment key={panel.key}>
                        <div
                          style={isLast ? undefined : { height: `${h}px` }}
                          className={`flex flex-col overflow-hidden ${isLast ? 'flex-1 min-h-[60px]' : 'flex-shrink-0'}`}
                        >
                          {panel.component}
                        </div>

                        {!isLast && (
                          <div
                            onPointerDown={(e) => handleRowResizeDown(panel.key, h, e)}
                            onPointerMove={(e) => handleRowResizeMove(panel.key, e)}
                            onPointerUp={(e) => handleRowResizeUp(panel.key, e)}
                            onPointerCancel={(e) => handleRowResizeUp(panel.key, e)}
                            title="ドラッグで上下パネルの縦幅を調整"
                            className="h-1.5 cursor-row-resize hover:bg-blue-500/80 active:bg-blue-600 bg-slate-300 dark:bg-slate-800 transition-colors z-20 touch-none flex-shrink-0 border-y border-slate-300/50 dark:border-slate-700/50"
                          />
                        )}
                      </React.Fragment>
                    );
                  });
                })()}
              </div>
            </div>
          )}
      </div>

      {/* Modals & Guards */}
      <AboutModal />
      <PreferencesModal />
      <ShortcutsModal />
      <ReplaceColorModal />
      <ExportVectorModal />
      <ExportTraceModal />
      <MobileGuard />

      {/* 🌟 右サイドパネル非表示時のみ表示される縦全高コンパクト再展開バー (Light/Darkテーマ対応) */}
      {!isRightSidebarOpen && (
        <button
          onClick={toggleRightSidebarOpen}
          title="右サイドパネルを展開 (Ctrl+Alt / Ctrl+Cmd)"
          className="fixed right-0 top-7 bottom-0 z-40 w-6 bg-slate-200/90 dark:bg-slate-800/90 hover:bg-blue-600 dark:hover:bg-blue-600 text-slate-700 dark:text-slate-300 hover:text-white dark:hover:text-white border-l border-slate-300 dark:border-slate-700 shadow-md transition-all duration-150 group flex flex-col items-center justify-center gap-2 cursor-pointer py-4"
        >
          <ChevronLeft className="w-4 h-4 flex-shrink-0 transition-transform group-hover:-translate-x-0.5" />
          <span className="text-[10px] font-bold tracking-widest [writing-mode:vertical-rl] select-none">
            右サイドパネル
          </span>
        </button>
      )}
    </div>
  );
};

export default App;
