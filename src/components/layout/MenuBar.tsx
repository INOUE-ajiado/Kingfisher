import React, { useState, useRef, useEffect } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { encodeTGA } from '../../engine/tga';
import { Moon, Sun } from 'lucide-react';

export const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const {
    isDarkMode,
    toggleDarkMode,
    currentImage,
    folderHandle,
    fileList,
    currentFileIndex,
    nextCell,
    prevCell,
    undo,
    redo,
    zoomIn,
    zoomOut,
    resetCanvasTransform,
    toggleShowGrid,
    toggleShowRuler,
    showGrid,
    showRuler,
    showUnpaintedFlash,
    toggleShowUnpaintedFlash,
    isSplitView,
    toggleIsSplitView,
    syncMode,
    toggleSyncMode,
    setActiveTool,
    togglePanelVisibility,
    panelVisibility,
    setActiveModal,
    separateLineartLayersGlobal,
  } = usePaintStore();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSave = async () => {
    if (currentImage && folderHandle && fileList[currentFileIndex]) {
      try {
        const fileName = fileList[currentFileIndex];
        const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        const buffer = encodeTGA(currentImage);
        await writable.write(buffer);
        await writable.close();
        alert(`ファイル [${fileName}] を上書き保存しました。`);
      } catch (err) {
        console.error('Failed to save file:', err);
        alert('保存に失敗しました。');
      }
    } else {
      alert('保存可能なファイルが開かれていません。');
    }
  };

  const menuData = [
    {
      id: 'file',
      label: 'ファイル (F)',
      items: [
        { label: '新規作成', shortcut: 'Ctrl+N', action: () => alert('新規セルを作成します。') },
        { label: '上書き保存', shortcut: 'Ctrl+S', action: handleSave },
        { label: '名前を付けて保存', shortcut: 'Ctrl+Shift+S', action: handleSave },
        { type: 'divider' },
        { label: '環境設定 & 画像補正', shortcut: 'Ctrl+K', action: () => setActiveModal('preferences') },
      ],
    },
    {
      id: 'edit',
      label: '編集 (E)',
      items: [
        { label: '元に戻す', shortcut: 'Ctrl+Z', action: undo },
        { label: 'やり直し', shortcut: 'Ctrl+Y', action: redo },
        { type: 'divider' },
        { label: '全セル一括色置換', shortcut: 'Ctrl+H', action: () => setActiveModal('replaceColor') },
        { label: '黒線・トレス線全自動レイヤー分離', shortcut: '', action: separateLineartLayersGlobal },
      ],
    },
    {
      id: 'view',
      label: '表示 (V)',
      items: [
        { label: '2画面分割表示 (Split View)', shortcut: '', checked: isSplitView, action: toggleIsSplitView },
        { label: '左右連動 (Sync Mode)', shortcut: '', checked: syncMode, action: toggleSyncMode },
        { type: 'divider' },
        { label: 'ズームイン', shortcut: 'Ctrl++', action: zoomIn },
        { label: 'ズームアウト', shortcut: 'Ctrl+-', action: zoomOut },
        { label: '等倍表示 (100%)', shortcut: 'Ctrl+1', action: resetCanvasTransform },
        { type: 'divider' },
        { label: 'ルーラーを表示', shortcut: 'Ctrl+R', checked: showRuler, action: toggleShowRuler },
        { label: 'グリッドを表示', shortcut: '', checked: showGrid, action: toggleShowGrid },
        { label: '未塗り漏れ点滅表示 (Unpainted Flash)', shortcut: 'Ctrl+F', checked: showUnpaintedFlash, action: toggleShowUnpaintedFlash },
      ],
    },
    {
      id: 'cell',
      label: 'セル (C)',
      items: [
        { label: '次のセルへ', shortcut: 'PageDown', action: nextCell },
        { label: '前のセルへ', shortcut: 'PageUp', action: prevCell },
        { type: 'divider' },
        { label: 'ゴミ取り (ノイズ除去)', shortcut: '', action: () => setActiveModal('preferences') },
        { label: '線画の二値化', shortcut: '', action: () => setActiveModal('preferences') },
      ],
    },
    {
      id: 'tool',
      label: 'ツール (T)',
      items: [
        { label: '塗りつぶし (バケツ)', shortcut: 'F', action: () => setActiveTool('fill') },
        { label: 'グラデーション塗り', shortcut: 'G', action: () => setActiveTool('gradient') },
        { label: '閉領域フィル', shortcut: 'C', action: () => setActiveTool('closedFill') },
        { label: 'ペイント (ブラシ)', shortcut: 'B', action: () => setActiveTool('brush') },
        { label: '鉛筆 (ドット2値)', shortcut: 'P', action: () => setActiveTool('pencil') },
        { label: '手動ワンクリックゴミ取り', shortcut: 'N', action: () => setActiveTool('noiseEraser') },
        { label: '消しゴム', shortcut: 'E', action: () => setActiveTool('eraser') },
        { label: 'スポイト', shortcut: 'Alt', action: () => setActiveTool('eyedropper') },
        { label: '手のひら (パン)', shortcut: 'Space', action: () => setActiveTool('pan') },
      ],
    },
    {
      id: 'window',
      label: 'ウィンドウ (W)',
      items: [
        { label: 'ツールパレット', shortcut: 'F5', checked: panelVisibility.toolPalette, action: () => togglePanelVisibility('toolPalette') },
        { label: 'ツールオプション', shortcut: 'F6', checked: panelVisibility.toolOptions, action: () => togglePanelVisibility('toolOptions') },
        { label: 'カラーチャート', shortcut: 'F7', checked: panelVisibility.colorChart, action: () => togglePanelVisibility('colorChart') },
        { label: 'ライトテーブル', shortcut: 'F8', checked: panelVisibility.lightTable, action: () => togglePanelVisibility('lightTable') },
        { label: 'ファイルブラウザ', shortcut: 'F9', checked: panelVisibility.fileBrowser, action: () => togglePanelVisibility('fileBrowser') },
        { label: 'ヒストリーパネル', shortcut: '', checked: panelVisibility.historyPanel, action: () => togglePanelVisibility('historyPanel') },
      ],
    },
    {
      id: 'help',
      label: 'ヘルプ (H)',
      items: [
        { label: 'ショートカット一覧', shortcut: '', action: () => setActiveModal('shortcuts') },
        { type: 'divider' },
        { label: 'Kingfisher について', shortcut: '', action: () => setActiveModal('about') },
      ],
    },
  ];

  return (
    <div ref={menuRef} className="h-8 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 text-xs text-slate-800 dark:text-slate-200 z-30 select-none relative">
      <div className="font-extrabold text-blue-600 dark:text-blue-400 mr-6 tracking-wider flex items-center gap-1.5 cursor-pointer">
        <span>🐦</span>
        <span>KINGFISHER</span>
      </div>

      <div className="flex gap-1">
        {menuData.map((menu) => {
          const isOpen = openMenu === menu.id;
          return (
            <div key={menu.id} className="relative">
              <button
                onClick={() => setOpenMenu(isOpen ? null : menu.id)}
                onMouseEnter={() => openMenu && setOpenMenu(menu.id)}
                className={`px-3 py-1 rounded transition-colors ${
                  isOpen
                    ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {menu.label}
              </button>

              {isOpen && (
                <div className="absolute top-full left-0 mt-0.5 w-60 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-lg py-1 z-40 text-xs animate-in fade-in zoom-in-95 duration-100">
                  {menu.items.map((item: any, idx: number) => {
                    if (item.type === 'divider') {
                      return <div key={idx} className="my-1 border-t border-slate-200 dark:border-slate-700" />;
                    }
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          item.action();
                          setOpenMenu(null);
                        }}
                        className="w-full px-3 py-1.5 text-left flex justify-between items-center text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          {item.checked !== undefined && (
                            <span className="w-3 text-blue-600 dark:text-blue-400 font-bold">{item.checked ? '✓' : ''}</span>
                          )}
                          <span>{item.label}</span>
                        </span>
                        {item.shortcut && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono ml-2">{item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-4">
        {/* Dark/Light mode toggle */}
        <button
          onClick={toggleDarkMode}
          title={isDarkMode ? 'Light Mode に切り替え' : 'Dark Mode に切り替え'}
          className="p-1.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-amber-500 transition-colors flex items-center gap-1.5 text-[11px] font-medium border border-slate-300 dark:border-slate-700"
        >
          {isDarkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
          <span>{isDarkMode ? 'Dark' : 'Light'}</span>
        </button>

        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
          Ver 2.0 (Split Studio)
        </span>
      </div>
    </div>
  );
};
