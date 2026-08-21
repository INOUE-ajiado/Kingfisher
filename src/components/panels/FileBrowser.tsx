import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { FolderOpen, Upload } from 'lucide-react';
import { decodeTGA } from '../../engine/tga';

export const FileBrowser: React.FC = () => {
  const {
    folderName,
    fileList,
    currentFileIndex,
    setCurrentFileIndex,
    setFolderHandle,
    setCurrentImage,
  } = usePaintStore();

  const handleOpenFolder = async () => {
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
        setFolderHandle(handle, handle.name, files);

        const firstFileHandle = await handle.getFileHandle(files[0]);
        const file = await firstFileHandle.getFile();
        const buffer = await file.arrayBuffer();
        const decoded = decodeTGA(buffer);
        setCurrentImage(decoded);
      } else {
        alert('選択したフォルダに .tga ファイルが見つかりませんでした。');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Error selecting folder:', err);
      }
    }
  };

  return (
    <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded flex flex-col shadow-sm select-none min-h-[140px]">
      <div className="h-7 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300 rounded-t">
        <div className="flex items-center gap-1.5 truncate">
          <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <span className="truncate">{folderName ? `Folder: ${folderName}` : 'Cell List'}</span>
        </div>
        <button
          onClick={handleOpenFolder}
          title="Open Local Folder"
          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded text-[10px] flex items-center gap-1 transition-colors font-medium"
        >
          <Upload className="w-3 h-3" />
          <span>Open</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        <ul className="space-y-0.5 text-xs">
          {fileList.map((fileName, index) => {
            const isActive = index === currentFileIndex;
            return (
              <li
                key={fileName}
                onClick={() => setCurrentFileIndex(index)}
                className={`px-2 py-1 rounded cursor-pointer flex justify-between items-center transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white font-medium'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="truncate">{fileName}</span>
                <span
                  className={`text-[10px] ${
                    isActive
                      ? 'text-emerald-200'
                      : index < currentFileIndex
                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {isActive ? 'Edit' : index < currentFileIndex ? 'Done' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
