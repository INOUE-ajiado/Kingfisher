import React, { useState, useRef, useEffect } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { collectImageFilesRecursively, isSupportedImageFile } from '../../engine/fileSystemPath';
import { Columns, Link, Link2Off, Pipette, Save } from 'lucide-react';
import { LogoTitle } from '../common/LogoTitle';

export const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const {
    isDarkMode,
    toggleDarkMode,
    setFolderHandleA,
    setFolderFilesA,
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
    convertWhiteToAlphaGlobal,
    runPegStabilizerAutoDetect,
    referenceCanvas,
    openReferenceImage,
    closeReferenceWindow,
    toggleReferenceFloating,
    colorSpecLayoutMode,
    setColorSpecLayoutMode,
    setAutoRevertTool,
    saveActiveCell,
    isDirtyA,
    isDirtyB,
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

  const handleOpenFolderDir = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const rootHandle = await (window as any).showDirectoryPicker();
        const rootName: string = rootHandle.name;
        const subDirs: any[] = [];

        // 直下のディレクトリごとに、その配下すべてを再帰的に集める
        for await (const entry of rootHandle.values()) {
          if (entry.kind !== 'directory') continue;

          const filesMap = new Map<string, File>();
          await collectImageFilesRecursively(entry, `${rootName}/${entry.name}`, filesMap);
          if (filesMap.size === 0) continue;

          const fileList = Array.from(filesMap.keys()).sort();
          const isImageFolder = fileList.some((f) => /\.(tga|png)$/i.test(f));

          subDirs.push({
            name: entry.name,
            // 相対パスで引くため、ハンドルはサブフォルダではなくルートを持たせる
            handle: rootHandle,
            filesMap,
            fileList,
            isImageFolder,
          });
        }

        subDirs.sort((a, b) => {
          if (a.name.startsWith('_') && !b.name.startsWith('_')) return -1;
          if (!a.name.startsWith('_') && b.name.startsWith('_')) return 1;
          return a.name.localeCompare(b.name);
        });

        if (subDirs.length > 0) {
          usePaintStore.getState().setCutRootFolder(rootHandle, rootName, subDirs);
          return;
        }

        // サブフォルダが無く、直下に画像がある場合
        const rootFiles = new Map<string, File>();
        await collectImageFilesRecursively(rootHandle, rootName, rootFiles);
        if (rootFiles.size > 0) {
          const files = Array.from(rootFiles.keys()).sort();
          setFolderHandleA(rootHandle, rootName, files, rootFiles);
          return;
        }

        alert('選択したフォルダに画像ファイル (.tga / .png / .jpg) が見つかりませんでした。');
        return;
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        console.error('Failed to open directory:', e);
      }
    }
    folderInputRef.current?.click();
  };

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // ⚠️ キーは webkitRelativePath (ルート名から始まる相対パス)。
    // ファイル名だけにすると階層違いの同名コマが上書きで消える。
    const filesMap = new Map<string, File>();
    let folderName = 'Loaded_Folder';

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!isSupportedImageFile(file.name)) continue;

      const relPath: string = (file as any).webkitRelativePath || file.name;
      filesMap.set(relPath, file);

      const parts = relPath.split('/');
      if (parts.length > 1) folderName = parts[0];
    }

    if (filesMap.size > 0) {
      // 表示中のコマの読み込みは useFrameLoader が行う。
      // ここで先頭ファイルを decodeTGA するとすぐ上書きされるうえ、
      // .png / .jpg を TGA として読んでしまう。
      setFolderFilesA(folderName, filesMap);
    } else {
      alert('選択したフォルダに画像ファイル (.tga / .png / .jpg) が見つかりませんでした。');
    }
  };

  const handleOpenReference = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'Image Files (*.tga, *.png, *.jpg)',
              accept: { 'image/*': ['.tga', '.png', '.jpg', '.jpeg'] },
            },
          ],
        });
        const file = await fileHandle.getFile();
        openReferenceImage(fileHandle, file.name);
      } else {
        openReferenceImage(null, 'Hero_ColorSpec.tga');
      }
    } catch (e) {
      openReferenceImage(null, 'Hero_ColorSpec.tga');
    }
  };

  // 保存処理はストア (saveActiveCell) に一本化されている。
  // アクティブビューの画像を、そのビュー側の実ファイル名へ書き戻す。
  const handleSave = async () => {
    const result = await saveActiveCell();
    alert(result.message);
  };

  const menuData = [
    {
      id: 'file',
      label: 'ファイル (F)',
      items: [
        { label: '新規作成', shortcut: 'Ctrl+N', action: () => alert('新規セルを作成します。') },
        { label: 'フォルダを開く (Open Directory)...', shortcut: 'Ctrl+Shift+O', action: handleOpenFolderDir },
        { label: '参照画像として開く (Open as Reference)...', shortcut: 'Ctrl+O', action: handleOpenReference },
        { type: 'divider' },
        { label: '上書き保存', shortcut: 'Ctrl+S', action: handleSave },
        { label: '名前を付けて保存', shortcut: 'Ctrl+Shift+S', action: handleSave },
        { type: 'divider' },
        { label: 'ベクター出力 (SVG)...', shortcut: '', action: () => setActiveModal('exportVector') },
        { label: '画像トレース / 背景透過 (PNG/TGA)...', shortcut: '', action: () => setActiveModal('exportTrace') },
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
        { label: 'タップ穴自動検出＆傾き補正 (Peg Stabilizer)', shortcut: '', action: runPegStabilizerAutoDetect },
        { label: '全セル一括色置換', shortcut: 'Ctrl+H', action: () => setActiveModal('replaceColor') },
        { label: '黒線・トレス線全自動レイヤー分離', shortcut: '', action: separateLineartLayersGlobal },
        { label: '線画の透過・アルファ抽出 (Unmultiply)', shortcut: '', action: convertWhiteToAlphaGlobal },
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
        { label: '次のセルへ', shortcut: 'PageDown / ↓', action: nextCell },
        { label: '前のセルへ', shortcut: 'PageUp / ↑', action: prevCell },
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
        {
          label: '参照ウィンドウを表示',
          shortcut: '',
          checked: referenceCanvas.isOpen,
          action: () => (referenceCanvas.isOpen ? closeReferenceWindow() : openReferenceImage()),
        },
        {
          label: '参照画面: 垂直分割',
          shortcut: '',
          checked: referenceCanvas.isOpen && !referenceCanvas.isFloating && colorSpecLayoutMode === 'split-vertical',
          action: () => {
            openReferenceImage();
            if (referenceCanvas.isFloating) toggleReferenceFloating();
            setColorSpecLayoutMode('split-vertical');
          },
        },
        {
          label: '参照画面: 水平分割',
          shortcut: '',
          checked: referenceCanvas.isOpen && !referenceCanvas.isFloating && colorSpecLayoutMode === 'split-horizontal',
          action: () => {
            openReferenceImage();
            if (referenceCanvas.isFloating) toggleReferenceFloating();
            setColorSpecLayoutMode('split-horizontal');
          },
        },
        {
          label: '参照ウィンドウの切り離し (Float)',
          shortcut: '',
          checked: referenceCanvas.isOpen && referenceCanvas.isFloating,
          action: () => {
            openReferenceImage();
            toggleReferenceFloating();
          },
        },
        {
          label: 'スポイト後ツール自動復帰 (Auto-Revert)',
          shortcut: '',
          checked: referenceCanvas.autoRevertTool,
          action: () => setAutoRevertTool(!referenceCanvas.autoRevertTool),
        },
        { type: 'divider' },
        { label: 'ツールパレット', shortcut: 'F5', checked: panelVisibility.toolPalette, action: () => togglePanelVisibility('toolPalette') },
        { label: 'ツールオプション', shortcut: 'F6', checked: panelVisibility.toolOptions, action: () => togglePanelVisibility('toolOptions') },
        { label: 'カラーチャート', shortcut: 'F7', checked: panelVisibility.colorChart, action: () => togglePanelVisibility('colorChart') },
        { label: 'ライトテーブル', shortcut: 'F8', checked: panelVisibility.lightTable, action: () => togglePanelVisibility('lightTable') },
        { label: 'ファイルブラウザ', shortcut: 'F9', checked: panelVisibility.fileBrowser, action: () => togglePanelVisibility('fileBrowser') },
        { label: 'ヒストリーパネル', shortcut: '', checked: panelVisibility.historyPanel, action: () => togglePanelVisibility('historyPanel') },
        { type: 'divider' },
        { label: 'ダークモード (Dark Mode)', shortcut: '', checked: isDarkMode, action: toggleDarkMode },
      ],
    },
    {
      id: 'help',
      label: 'ヘルプ (H)',
      items: [
        {
          label: '仕様書・取扱説明書 (Manual)',
          shortcut: 'F1',
          action: () => window.open('/Kingfisher_Manual.html', '_blank'),
        },
        { label: 'ショートカット一覧', shortcut: '', action: () => setActiveModal('shortcuts') },
        { type: 'divider' },
        { label: 'Kingfisher について', shortcut: '', action: () => setActiveModal('about') },
      ],
    },
  ];

  return (
    <div ref={menuRef} className="h-7 bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 flex items-center px-2 text-xs text-slate-800 dark:text-slate-200 z-50 select-none relative">
      {/* アイコン ＆ KINGFISHER Speed & Dynamic タイトルロゴ */}
      <div
        onClick={() => setActiveModal('about')}
        title="Kingfisher について (About)"
        className="mr-3 sm:mr-5 flex items-center gap-1.5 cursor-pointer select-none hover:opacity-90 transition-opacity flex-shrink-0"
      >
        <img
          src="/icon.jpg"
          alt="Kingfisher Icon"
          className="w-4 h-4 sm:w-5 sm:h-5 rounded-md object-cover shadow-xs border border-slate-200 dark:border-slate-700 flex-shrink-0"
        />
        <LogoTitle size="sm" />
      </div>

      {/* メニューアイテム */}
      <div className="flex gap-0.5 sm:gap-1 flex-shrink-0">
        {menuData.map((menu) => {
          const isOpen = openMenu === menu.id;
          return (
            <div key={menu.id} className="relative">
              <button
                onClick={() => setOpenMenu(isOpen ? null : menu.id)}
                onMouseEnter={() => openMenu && setOpenMenu(menu.id)}
                className={`px-1.5 sm:px-2.5 py-0.5 rounded transition-colors text-[11px] whitespace-nowrap ${
                  isOpen
                    ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {menu.label}
              </button>

              {isOpen && (
                <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-2xl py-1 z-[9999] text-xs animate-in fade-in zoom-in-95 duration-100">
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

      <div className="ml-auto flex items-center gap-2">
        {/* 💾 未保存インジケーター ＆ 保存ボタン */}
        <button
          id="save-current-cell-btn"
          onClick={handleSave}
          title="アクティブなウィンドウのセルを上書き保存 (Ctrl+S)"
          className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-colors border ${
            isDirtyA || isDirtyB
              ? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-600 shadow-xs'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-700'
          }`}
        >
          <Save className="w-3.5 h-3.5" />
          <span>
            {isDirtyA || isDirtyB
              ? `未保存${isDirtyA ? ' A' : ''}${isDirtyB ? ' B' : ''}`
              : '保存済み'}
          </span>
        </button>

        {/* 統合アクションボタン群 (左右比較・左右連動・参照画像) */}
        <div className="flex items-center gap-1 border-r border-slate-200 dark:border-slate-800 pr-2">
          <button
            onClick={toggleIsSplitView}
            title="画面を左右2分割してセルを並べて比較 (Win A / Win B)"
            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-colors ${
              isSplitView
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>左右に並べる</span>
          </button>

          {isSplitView && (
            <button
              onClick={toggleSyncMode}
              title="左右ウィンドウのコマ送りを完全同調・連動"
              className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-colors ${
                syncMode
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700'
              }`}
            >
              {syncMode ? <Link className="w-3.5 h-3.5" /> : <Link2Off className="w-3.5 h-3.5" />}
              <span>左右連動</span>
            </button>
          )}

          <button
            onClick={handleOpenReference}
            title="作画比較用の参照画像 (TGA/PNG/JPG) を開く"
            className="px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition-colors"
          >
            <Pipette className="w-3.5 h-3.5" />
            <span>参照画像を開く</span>
          </button>
        </div>
      </div>

      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderInputChange}
        className="hidden"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
      />
    </div>
  );
};
