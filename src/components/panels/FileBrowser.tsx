import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { FolderOpen, Link, Link2Off, AlertCircle } from 'lucide-react';
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
    activeViewIndex,
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

  const handleSelectFile = (index: number) => {
    if (syncMode) {
      setCurrentFileIndex(index);
      setSplitFileIndex(index);
    } else {
      if (activeViewIndex === 0) {
        setCurrentFileIndex(index);
      } else {
        setSplitFileIndex(index);
      }
    }
  };

  return (
    <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex flex-col shadow-sm select-none min-h-[160px]">
      {/* 統合ファイルブラウザ ヘッダー */}
      <div className="h-7 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300 rounded-t">
        <div className="flex items-center gap-1.5 truncate">
          <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <span className="truncate">統合ファイルブラウザ</span>
        </div>
        {/* 連動トグル */}
        <button
          onClick={toggleSyncMode}
          title="左右連動ナビゲーション"
          className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 font-bold border transition-colors ${
            syncMode
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
          }`}
        >
          {syncMode ? <Link className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
          <span>{syncMode ? '連動ON' : 'OFF'}</span>
        </button>
      </div>

      {/* 2フォルダ パス表示 & 読み込みボタン */}
      <div className="p-1.5 border-b border-slate-200 dark:border-slate-800 text-[10px] space-y-1 bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center justify-between">
          <span className="truncate text-slate-600 dark:text-slate-400 font-mono">
            A (Orig): <span className="font-semibold text-slate-800 dark:text-slate-200">{folderNameA}</span>
          </span>
          <button
            onClick={handleOpenFolderA}
            className="text-[9px] bg-blue-600 hover:bg-blue-700 text-white px-1.5 py-0.5 rounded font-medium"
          >
            Open A
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="truncate text-slate-600 dark:text-slate-400 font-mono">
            B (Retake): <span className="font-semibold text-slate-800 dark:text-slate-200">{folderNameB}</span>
          </span>
          <button
            onClick={handleOpenFolderB}
            className="text-[9px] bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 rounded font-medium"
          >
            Open B
          </button>
        </div>
      </div>

      {/* 統合リストビュー (ファイル名 | Win A | Win B) */}
      <div className="flex-1 overflow-y-auto p-1">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <th className="pb-1 font-semibold">ファイル名</th>
              <th className="pb-1 text-center font-semibold">Win A</th>
              <th className="pb-1 text-center font-semibold">Win B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {unifiedFileList.map((fileName, index) => {
              const inA = fileListA.includes(fileName);
              const inB = fileListB.includes(fileName);

              const isCurrentA = index === currentFileIndex;
              const isCurrentB = index === splitFileIndex;

              return (
                <tr
                  key={fileName}
                  onClick={() => handleSelectFile(index)}
                  className={`cursor-pointer transition-colors ${
                    isCurrentA || isCurrentB
                      ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <td className="py-1 px-1 truncate font-mono text-[11px]">
                    {isCurrentA ? '▶ ' : ''}{fileName}
                  </td>
                  {/* Win A 状態 */}
                  <td className="py-1 text-center">
                    {inA ? (
                      isCurrentA ? (
                        <span className="text-[9px] bg-blue-600 text-white px-1 py-0.5 rounded font-bold">編</span>
                      ) : (
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">済</span>
                      )
                    ) : (
                      <span className="text-[9px] text-slate-300 dark:text-slate-600">-</span>
                    )}
                  </td>
                  {/* Win B 状態 */}
                  <td className="py-1 text-center">
                    {inB ? (
                      isCurrentB ? (
                        <span className="text-[9px] bg-emerald-600 text-white px-1 py-0.5 rounded font-bold">編</span>
                      ) : (
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">済</span>
                      )
                    ) : (
                      <span className="text-[9px] text-red-500 font-bold flex items-center justify-center gap-0.5">
                        <AlertCircle className="w-3 h-3" />
                        欠落
                      </span>
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
