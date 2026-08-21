import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { FolderOpen, Link, Link2Off, AlertTriangle } from 'lucide-react';
import { decodeTGA } from '../../engine/tga';

export const FileBrowser: React.FC = () => {
  const {
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
    setCurrentImage,
    syncMode,
    toggleSyncMode,
  } = usePaintStore();

  const handleOpenFolderA = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker();
      const files: string[] = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.tga')) {
          files.push(entry.name);
        }
      }
      files.sort();
      if (files.length > 0) {
        setFolderHandleA(handle, handle.name, files);
        const firstFileHandle = await handle.getFileHandle(files[0]);
        const file = await firstFileHandle.getFile();
        const buffer = await file.arrayBuffer();
        const decoded = decodeTGA(buffer);
        setCurrentImage(decoded);
      } else {
        alert('選択した Dir A フォルダに .tga ファイルが見つかりませんでした。');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error('Error selecting Dir A:', err);
    }
  };

  const handleOpenFolderB = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker();
      const files: string[] = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.tga')) {
          files.push(entry.name);
        }
      }
      files.sort();
      if (files.length > 0) {
        setFolderHandleB(handle, handle.name, files);
      } else {
        alert('選択した Dir B フォルダに .tga ファイルが見つかりませんでした。');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error('Error selecting Dir B:', err);
    }
  };

  // 左カラムクリック (Win A 独立選択)
  const handleSelectWinA = (index: number) => {
    if (syncMode) {
      setCurrentFileIndex(index);
      setSplitFileIndex(index);
    } else {
      setCurrentFileIndex(index);
    }
  };

  // 右カラムクリック (Win B 独立選択)
  const handleSelectWinB = (index: number) => {
    if (syncMode) {
      setCurrentFileIndex(index);
      setSplitFileIndex(index);
    } else {
      setSplitFileIndex(index);
    }
  };

  // 中央カラムクリック (連動選択)
  const handleSelectUnified = (index: number) => {
    setCurrentFileIndex(index);
    if (syncMode) {
      setSplitFileIndex(index);
    }
  };

  return (
    <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex flex-col shadow-sm select-none min-h-[180px]">
      {/* 統合ファイルブラウザ ヘッダー */}
      <div className="h-7 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300 rounded-t">
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
          <span>{syncMode ? '連動 ON' : '連動 OFF'}</span>
        </button>
      </div>

      {/* 2フォルダ パス表示 & 読み込みボタン */}
      <div className="p-1.5 border-b border-slate-200 dark:border-slate-800 text-[10px] space-y-1 bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center justify-between">
          <span className="truncate text-slate-600 dark:text-slate-400 font-mono">
            A (Orig): <span className="font-semibold text-blue-600 dark:text-blue-400">{folderNameA}</span>
          </span>
          <button
            onClick={handleOpenFolderA}
            className="text-[9px] bg-blue-600 hover:bg-blue-700 text-white px-1.5 py-0.5 rounded font-medium shadow-xs"
          >
            Open A
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="truncate text-slate-600 dark:text-slate-400 font-mono">
            B (Retake): <span className="font-semibold text-emerald-600 dark:text-emerald-400">{folderNameB}</span>
          </span>
          <button
            onClick={handleOpenFolderB}
            className="text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 rounded font-medium shadow-xs"
          >
            Open B
          </button>
        </div>
      </div>

      {/* 3カラム UIレイアウト (Win A 選択 | 統合ファイル名 | Win B 選択) */}
      <div className="flex-1 overflow-y-auto p-1">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-800 select-none">
              <th className="pb-1 text-left w-1/3 font-semibold pl-1">Win A (Orig)</th>
              <th className="pb-1 text-center font-semibold">統合ファイル名</th>
              <th className="pb-1 text-right w-1/3 font-semibold pr-1">Win B (Retake)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {unifiedFileList.map((fileName, index) => {
              const inA = fileListA.includes(fileName);
              const inB = fileListB.includes(fileName);

              const isActiveA = index === currentFileIndex;
              const isActiveB = index === splitFileIndex;

              return (
                <tr key={fileName} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  {/* 左カラム: Win A 選択・ハイライト領域 */}
                  <td
                    onClick={() => inA && handleSelectWinA(index)}
                    className="py-1 px-0.5 cursor-pointer text-left"
                  >
                    {isActiveA ? (
                      <div className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center justify-between">
                        <span className="truncate">{fileName}</span>
                        <span className="text-[9px] opacity-80 ml-0.5">◀</span>
                      </div>
                    ) : inA ? (
                      <div className="text-[10px] text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 px-1 truncate hover:font-semibold transition-colors">
                        [ A開く ]
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-300 dark:text-slate-600 px-1 flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5 text-amber-500/70" />
                        <span>-</span>
                      </div>
                    )}
                  </td>

                  {/* 中央カラム: 統合ファイル名 */}
                  <td
                    onClick={() => handleSelectUnified(index)}
                    className={`py-1 text-center font-mono text-[11px] cursor-pointer truncate px-1 ${
                      isActiveA || isActiveB
                        ? 'font-bold text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {fileName}
                  </td>

                  {/* 右カラム: Win B 選択・ハイライト領域 */}
                  <td
                    onClick={() => inB && handleSelectWinB(index)}
                    className="py-1 px-0.5 cursor-pointer text-right"
                  >
                    {isActiveB ? (
                      <div className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center justify-between">
                        <span className="text-[9px] opacity-80 mr-0.5">▶</span>
                        <span className="truncate">{fileName}</span>
                      </div>
                    ) : inB ? (
                      <div className="text-[10px] text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 px-1 truncate hover:font-semibold transition-colors">
                        [ B開く ]
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-500 font-bold px-1 flex items-center justify-end gap-0.5" title="Win B にファイルがありません (欠落)">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
