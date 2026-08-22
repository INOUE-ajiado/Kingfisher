import React, { useRef } from 'react';
import { usePaintStore, SubDirectoryItem } from '../../store/usePaintStore';
import { FolderOpen, Link, Link2Off, AlertTriangle } from 'lucide-react';

export const FileBrowser: React.FC = () => {
  const fileInputRefA = useRef<HTMLInputElement | null>(null);
  const fileInputRefB = useRef<HTMLInputElement | null>(null);

  const {
    rootFolderName,
    availableSubDirectories,
    selectedSubDirA,
    selectedSubDirB,
    mergedFrameNumbers,
    mergedFrameMap,
    setCutRootFolder,
    setSelectedSubDirA,
    setSelectedSubDirB,
    folderNameA,
    folderNameB,
    fileListA,
    fileListB,
    unifiedFileList,
    currentFileIndex,
    splitFileIndex,
    setCurrentFileIndex,
    setSplitFileIndex,
    setFolderHandleA,
    setFolderHandleB,
    setFolderFilesA,
    setFolderFilesB,
    syncMode,
    toggleSyncMode,
  } = usePaintStore();

  // カットフォルダ（ルート）一括読み込み
  const handleOpenCutRootFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      alert('お使いのブラウザはフォルダ一括選択APIに対応していません。');
      return;
    }

    try {
      const rootHandle = await (window as any).showDirectoryPicker();
      const subDirs: SubDirectoryItem[] = [];

      for await (const entry of rootHandle.values()) {
        if (entry.kind === 'directory') {
          const filesMap = new Map<string, File>();
          const fileList: string[] = [];
          let isImageFolder = false;

          for await (const fileEntry of entry.values()) {
            if (fileEntry.kind === 'file') {
              const lower = fileEntry.name.toLowerCase();
              if (lower.endsWith('.tga') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
                fileList.push(fileEntry.name);
                try {
                  const file = await fileEntry.getFile();
                  filesMap.set(fileEntry.name, file);
                } catch (e) {
                  console.error('File getFile error:', e);
                }
                if (lower.endsWith('.tga') || lower.endsWith('.png')) isImageFolder = true;
              }
            }
          }

          fileList.sort();
          if (fileList.length > 0) {
            subDirs.push({
              name: entry.name,
              handle: entry,
              filesMap,
              fileList,
              isImageFolder,
            });
          }
        }
      }

      // サブフォルダをプレフィックス順（_ 始まり優先）にソート
      subDirs.sort((a, b) => {
        if (a.name.startsWith('_') && !b.name.startsWith('_')) return -1;
        if (!a.name.startsWith('_') && b.name.startsWith('_')) return 1;
        return a.name.localeCompare(b.name);
      });

      if (subDirs.length > 0) {
        setCutRootFolder(rootHandle, rootHandle.name, subDirs);
      } else {
        // 直下に直接TGA/JPGファイルがある場合
        const filesMap = new Map<string, File>();
        const fileList: string[] = [];
        for await (const fileEntry of rootHandle.values()) {
          if (fileEntry.kind === 'file') {
            const lower = fileEntry.name.toLowerCase();
            if (lower.endsWith('.tga') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
              fileList.push(fileEntry.name);
              const file = await fileEntry.getFile();
              filesMap.set(fileEntry.name, file);
            }
          }
        }
        fileList.sort();
        if (fileList.length > 0) {
          const directSubDir: SubDirectoryItem = {
            name: '(Root)',
            handle: rootHandle,
            filesMap,
            fileList,
            isImageFolder: true,
          };
          setCutRootFolder(rootHandle, rootHandle.name, [directSubDir]);
        } else {
          alert('選択したフォルダに画像ファイルが見つかりませんでした。');
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Error opening root cut folder:', err);
    }
  };

  const handleOpenFolderA = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker();
        const files: string[] = [];
        for await (const entry of handle.values()) {
          if (entry.kind === 'file' && (entry.name.toLowerCase().endsWith('.tga') || entry.name.toLowerCase().endsWith('.jpg'))) {
            files.push(entry.name);
          }
        }
        files.sort();
        if (files.length > 0) {
          setFolderHandleA(handle, handle.name, files);
          return;
        } else {
          alert('選択した Dir A フォルダに画像ファイルが見つかりませんでした。');
          return;
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }
    fileInputRefA.current?.click();
  };

  const handleOpenFolderB = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker();
        const files: string[] = [];
        for await (const entry of handle.values()) {
          if (entry.kind === 'file' && (entry.name.toLowerCase().endsWith('.tga') || entry.name.toLowerCase().endsWith('.jpg'))) {
            files.push(entry.name);
          }
        }
        files.sort();
        if (files.length > 0) {
          setFolderHandleB(handle, handle.name, files);
          return;
        } else {
          alert('選択した Dir B フォルダに画像ファイルが見つかりませんでした。');
          return;
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }
    fileInputRefB.current?.click();
  };

  const handleFileInputChangeA = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesMap = new Map<string, File>();
    let folderName = 'Folder_A';

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.name.toLowerCase().endsWith('.tga') || file.name.toLowerCase().endsWith('.jpg')) {
        filesMap.set(file.name, file);
        if ((file as any).webkitRelativePath) {
          const parts = (file as any).webkitRelativePath.split('/');
          if (parts.length > 1) folderName = parts[0];
        }
      }
    }

    if (filesMap.size > 0) {
      setFolderFilesA(folderName, filesMap);
    }
  };

  const handleFileInputChangeB = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesMap = new Map<string, File>();
    let folderName = 'Folder_B';

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.name.toLowerCase().endsWith('.tga') || file.name.toLowerCase().endsWith('.jpg')) {
        filesMap.set(file.name, file);
        if ((file as any).webkitRelativePath) {
          const parts = (file as any).webkitRelativePath.split('/');
          if (parts.length > 1) folderName = parts[0];
        }
      }
    }

    if (filesMap.size > 0) {
      setFolderFilesB(folderName, filesMap);
    }
  };

  // 連番フレーム行クリック時の連動・個別のルーティング挙動
  const handleSelectFrame = (idx: number) => {
    setCurrentFileIndex(idx);
    if (syncMode) {
      setSplitFileIndex(idx);
    }
  };

  const handleSelectWinAOnly = (idx: number) => {
    setCurrentFileIndex(idx);
    if (syncMode) setSplitFileIndex(idx);
  };

  const handleSelectWinBOnly = (idx: number) => {
    setSplitFileIndex(idx);
    if (syncMode) setCurrentFileIndex(idx);
  };

  return (
    <div className="flex-1 bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 flex flex-col select-none min-h-[200px]">
      {/* 1. 統合ファイルブラウザ ヘッダー */}
      <div className="h-6 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-1.5 truncate">
          <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <span className="truncate">統合ファイルブラウザ</span>
        </div>
        {/* 連動トグル */}
        <button
          onClick={toggleSyncMode}
          title={syncMode ? '左右連動中 (クリックで独立モードへ)' : '独立モード (クリックで連動モードへ)'}
          className={`px-2 py-0.5 rounded text-[10px] flex items-center gap-1 font-bold border transition-colors ${
            syncMode
              ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
              : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
          }`}
        >
          {syncMode ? <Link className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
          <span>{syncMode ? '連動 ON' : '独立'}</span>
        </button>
      </div>

      {/* 2. カット袋 (ルートフォルダ) 表示 & 一括選択 */}
      <div className="p-1.5 border-b border-slate-200 dark:border-slate-800 text-[10px] bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 truncate text-slate-700 dark:text-slate-300">
          <span className="font-bold text-slate-500">ルート:</span>
          <span className="font-semibold text-blue-600 dark:text-blue-400 truncate">
            {rootFolderName || '(カット未選択)'}
          </span>
        </div>
        <button
          onClick={handleOpenCutRootFolder}
          title="カットフォルダ（デジタルカット袋）を丸ごと選択してスキャン"
          className="text-[9px] bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded font-bold shadow-xs whitespace-nowrap flex items-center gap-1 transition-colors"
        >
          <FolderOpen className="w-3 h-3" />
          <span>カットを開く</span>
        </button>
      </div>

      {/* 3. サブフォルダセレクタ (Win A / Win B) */}
      <div className="p-1.5 border-b border-slate-200 dark:border-slate-800 text-[10px] grid grid-cols-2 gap-1.5 bg-white dark:bg-slate-900">
        {/* Win A セレクタ */}
        <div className="flex items-center gap-1">
          <span className="font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">Win A:</span>
          {availableSubDirectories.length > 0 ? (
            <select
              value={selectedSubDirA || ''}
              onChange={(e) => setSelectedSubDirA(e.target.value)}
              className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-[10px] font-semibold text-slate-800 dark:text-slate-200 truncate cursor-pointer"
            >
              {availableSubDirectories.map((dir) => (
                <option key={`a-${dir.name}`} value={dir.name}>
                  {dir.name} ({dir.fileList.length})
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={handleOpenFolderA}
              className="flex-1 text-left text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 truncate bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700"
            >
              {folderNameA || 'フォルダ選択'}
            </button>
          )}
        </div>

        {/* Win B セレクタ */}
        <div className="flex items-center gap-1">
          <span className="font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">Win B:</span>
          {availableSubDirectories.length > 0 ? (
            <select
              value={selectedSubDirB || ''}
              onChange={(e) => setSelectedSubDirB(e.target.value)}
              className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-[10px] font-semibold text-slate-800 dark:text-slate-200 truncate cursor-pointer"
            >
              {availableSubDirectories.map((dir) => (
                <option key={`b-${dir.name}`} value={dir.name}>
                  {dir.name} ({dir.fileList.length})
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={handleOpenFolderB}
              className="flex-1 text-left text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 truncate bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700"
            >
              {folderNameB || 'フォルダ選択'}
            </button>
          )}
        </div>
      </div>

      {/* 4. 異名連番マージリスト (Win A 素材 | 連番フレーム | Win B 素材) */}
      <div className="flex-1 overflow-y-auto p-1">
        {mergedFrameNumbers.length === 0 && unifiedFileList.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-3 text-slate-400">
            <span className="text-[11px] font-medium mb-1">カットが読み込まれていません</span>
            <span className="text-[9px] text-slate-400 leading-relaxed">
              [カットを開く] から ATO_07_213_r などのカットフォルダを選択してください
            </span>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-[9px] text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-800 select-none">
                <th className="pb-1 text-left w-2/5 font-semibold pl-1">Win A ({selectedSubDirA || folderNameA || 'Orig'})</th>
                <th className="pb-1 text-center font-semibold">フレーム</th>
                <th className="pb-1 text-right w-2/5 font-semibold pr-1">Win B ({selectedSubDirB || folderNameB || 'Retake'})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {mergedFrameNumbers.length > 0
                ? mergedFrameNumbers.map((frameNum, index) => {
                    const item = mergedFrameMap.get(frameNum);
                    const fileA = item?.fileNameA;
                    const fileB = item?.fileNameB;

                    const isActiveA = index === currentFileIndex;
                    const isActiveB = index === splitFileIndex;

                    return (
                      <tr key={frameNum} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        {/* 左カラム: Win A 対応ファイル */}
                        <td
                          onClick={() => fileA && handleSelectWinAOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-left"
                        >
                          {isActiveA && fileA ? (
                            <div className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center justify-between">
                              <span className="truncate">{fileA}</span>
                              <span className="text-[8px] opacity-80 ml-0.5">◀</span>
                            </div>
                          ) : fileA ? (
                            <div className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 px-1 truncate transition-colors">
                              {fileA}
                            </div>
                          ) : (
                            <div className="text-[9px] text-slate-300 dark:text-slate-600 px-1 italic">
                              -
                            </div>
                          )}
                        </td>

                        {/* 中央カラム: 4桁連番フレーム番号 */}
                        <td
                          onClick={() => handleSelectFrame(index)}
                          className={`py-1 text-center font-mono text-[11px] cursor-pointer truncate px-1 ${
                            isActiveA || isActiveB
                              ? 'font-bold text-blue-600 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-900/30 rounded'
                              : 'text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                        >
                          {frameNum}
                        </td>

                        {/* 右カラム: Win B 対応ファイル */}
                        <td
                          onClick={() => fileB && handleSelectWinBOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-right"
                        >
                          {isActiveB && fileB ? (
                            <div className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center justify-between">
                              <span className="text-[8px] opacity-80 mr-0.5">▶</span>
                              <span className="truncate">{fileB}</span>
                            </div>
                          ) : fileB ? (
                            <div className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-1 truncate transition-colors">
                              {fileB}
                            </div>
                          ) : (
                            <div className="text-[9px] text-amber-500/80 font-bold px-1 flex items-center justify-end gap-0.5" title="Win B に対応セルがありません">
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
                              <span>欠落</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                : unifiedFileList.map((fileName, index) => {
                    const inA = fileListA.includes(fileName);
                    const inB = fileListB.includes(fileName);
                    const isActiveA = index === currentFileIndex;
                    const isActiveB = index === splitFileIndex;

                    return (
                      <tr key={fileName} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td
                          onClick={() => inA && handleSelectWinAOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-left"
                        >
                          {isActiveA ? (
                            <div className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs truncate">
                              {fileName}
                            </div>
                          ) : inA ? (
                            <div className="text-[10px] text-slate-500 hover:text-blue-600 px-1 truncate">
                              {fileName}
                            </div>
                          ) : (
                            <div className="text-[9px] text-slate-300 px-1">-</div>
                          )}
                        </td>
                        <td
                          onClick={() => handleSelectFrame(index)}
                          className="py-1 text-center font-mono text-[11px] cursor-pointer truncate px-1 text-slate-700 dark:text-slate-300"
                        >
                          {fileName}
                        </td>
                        <td
                          onClick={() => inB && handleSelectWinBOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-right"
                        >
                          {isActiveB ? (
                            <div className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs truncate">
                              {fileName}
                            </div>
                          ) : inB ? (
                            <div className="text-[10px] text-slate-500 hover:text-emerald-600 px-1 truncate">
                              {fileName}
                            </div>
                          ) : (
                            <div className="text-[9px] text-amber-500 font-bold px-1 text-right">欠落</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRefA}
        onChange={handleFileInputChangeA}
        className="hidden"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
      />
      <input
        type="file"
        ref={fileInputRefB}
        onChange={handleFileInputChangeB}
        className="hidden"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
      />
    </div>
  );
};
