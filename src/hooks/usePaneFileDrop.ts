import { useEffect, useRef, useState } from 'react';
import { usePaintStore } from '../store/usePaintStore';
import {
  collectImageFilesFromEntry,
  collectImageFilesRecursively,
  isSupportedImageFile,
  resolveDropHandles,
} from '../engine/fileSystemPath';
import { readDropItems, readMultipleDroppedFolders } from '../engine/dropFolder';
import { collectDroppedVideoFiles, commonRootName } from '../engine/videoSource';
import { sortNatural } from '../engine/naturalOrder';
import { isPaneDrag } from '../components/panels/PaneTabBar';
import { RollId } from '../store/types';

/**
 * エクスプローラーから Win A / Win B へフォルダや映像を落とすときの受け口。
 *
 * ⚠️ CellWindow に直接書かないこと。1 つの部品がレイアウトも描画も
 * 取り込みも抱えると、どこを直しているのか分からなくなる。
 */
export function usePaneFileDrop() {
  const setCustomDropFolderA = usePaintStore((s) => s.setCustomDropFolderA);
  const setCustomDropFolderB = usePaintStore((s) => s.setCustomDropFolderB);
  const setFolderHandleA = usePaintStore((s) => s.setFolderHandleA);
  const setFolderHandleB = usePaintStore((s) => s.setFolderHandleB);
  const loadRollFiles = usePaintStore((s) => s.loadRollFiles);

  const [isWinADragOver, setIsWinADragOver] = useState(false);
  const [isWinBDragOver, setIsWinBDragOver] = useState(false);

  /**
   * ファイルのドラッグ判定。
   *
   * dragenter / dragleave は子要素をまたぐたびに親へバブリングしてくる。
   * さらに Chrome / WebKit では dragleave が dragenter より先に発火することがあり、
   * 出入りの回数を数えるだけでは一瞬 0 になってハイライトが点滅する。
   * そこで発火順に依存しない 2 段構えにする。
   *
   *  1. dragleave は relatedTarget が自分の内側なら無視する (子要素への移動)
   *  2. dragover を心拍とみなし、一定時間届かなくなったら解除する
   *     (relatedTarget が null になるブラウザ差異への保険)
   */
  const DRAG_HEARTBEAT_MS = 500;
  const dragClearTimer = useRef<{ winA: number | null; winB: number | null }>({
    winA: null,
    winB: null,
  });

  const setDragOverState = (win: 'winA' | 'winB', active: boolean) => {
    if (win === 'winA') setIsWinADragOver(active);
    else setIsWinBDragOver(active);
  };

  const resetDragState = (win: 'winA' | 'winB') => {
    if (dragClearTimer.current[win] !== null) {
      clearTimeout(dragClearTimer.current[win]!);
      dragClearTimer.current[win] = null;
    }
    setDragOverState(win, false);
  };

  /**
   * ドラッグ継続中であることを記録し、途切れたら自動で解除する。
   *
   * ハイライトは常にどちらか一方だけ。Win A の上を通過して Win B へ入ると、
   * 心拍のタイムアウトが切れるまで Win A も光ったままになり、
   * どちらに取り込まれるのか分からなくなるため、相手側は即座に消す。
   */
  const keepDragAlive = (win: 'winA' | 'winB') => {
    const other: 'winA' | 'winB' = win === 'winA' ? 'winB' : 'winA';
    if (dragClearTimer.current[other] !== null) {
      clearTimeout(dragClearTimer.current[other]!);
      dragClearTimer.current[other] = null;
    }
    setDragOverState(other, false);

    setDragOverState(win, true);
    if (dragClearTimer.current[win] !== null) clearTimeout(dragClearTimer.current[win]!);
    dragClearTimer.current[win] = window.setTimeout(() => {
      dragClearTimer.current[win] = null;
      setDragOverState(win, false);
    }, DRAG_HEARTBEAT_MS);
  };

  /** ファイル / フォルダのドラッグかどうか (テキスト選択のドラッグ等を無視する) */
  const isFileDrag = (e: React.DragEvent) => {
    const types = e.dataTransfer?.types;
    return !!types && Array.prototype.includes.call(types, 'Files');
  };

  const handleWindowDragEnter = (e: React.DragEvent, win: 'winA' | 'winB') => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    keepDragAlive(win);
  };

  const handleWindowDragOver = (e: React.DragEvent, win: 'winA' | 'winB') => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // 毎回指定しないとブラウザが「ドロップ不可」と判断して drop が発火しない
    e.dataTransfer.dropEffect = 'copy';
    keepDragAlive(win);
  };

  const handleWindowDragLeave = (e: React.DragEvent, win: 'winA' | 'winB') => {
    // 子要素へ移動しただけの dragleave は無視する
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    e.stopPropagation();
    resetDragState(win);
  };

  // ドラッグがウィンドウ外で終わった場合にハイライトが残らないようにする
  useEffect(() => {
    const clearAll = () => {
      resetDragState('winA');
      resetDragState('winB');
    };
    window.addEventListener('dragend', clearAll);
    window.addEventListener('drop', clearAll);
    return () => {
      window.removeEventListener('dragend', clearAll);
      window.removeEventListener('drop', clearAll);
    };
  }, []);

  /**
   * エクスプローラーから Win A / Win B へフォルダを落としたときの読み込み。
   *
   * ⚠️ 書き込みたいので getAsFileSystemHandle() を優先する。
   * webkitGetAsEntry() が返す FileSystemEntry は読み取り専用で、
   * これしか取らないと「ドロップしたフォルダは保存できない」状態になる。
   * getAsFileSystemHandle() に対応しない環境 (Firefox / Safari) では
   * 従来どおりエントリ経由で読み込み、保存だけができない扱いにする。
   */
  const handleFolderOrFilesNativeDrop = async (e: React.DragEvent, targetWin: 'winA' | 'winB') => {
    // ⚠️ タブの移動をここで拾わないこと。ファイルが 1 つも無いので
    // 「画像ファイルが見つかりませんでした」が出てしまう
    if (isPaneDrag(e.dataTransfer)) return;

    e.preventDefault();
    e.stopPropagation();

    resetDragState('winA');
    resetDragState('winB');

    const items = readDropItems(e.dataTransfer);
    const store = usePaintStore.getState();

    const multi = await readMultipleDroppedFolders(items, store);
    if (multi.handled) return;

    const { plainFiles, handlePromises, entries } = items;

    const isWinA = targetWin === 'winA';
    const fileMap = new Map<string, File>();

    // --- 1. 書き込み可能なディレクトリハンドルが取れる場合 ---
    const handles = await resolveDropHandles(handlePromises);
    const dirHandle = handles.find((h: any) => h?.kind === 'directory') ?? null;

    if (dirHandle) {
      await collectImageFilesRecursively(dirHandle, dirHandle.name, fileMap);
      if (fileMap.size > 0) {
        const fileList = sortNatural(fileMap.keys());
        // 保存できる経路なので、ハンドルを持つ通常のフォルダとして登録する
        if (isWinA) setFolderHandleA(dirHandle, dirHandle.name, fileList, fileMap);
        else setFolderHandleB(dirHandle, dirHandle.name, fileList, fileMap);
        return;
      }
    }

    // --- 2. 読み取り専用のフォールバック (FileSystemEntry / 素のファイル) ---
    let detectedFolderName: string | null = null;

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!detectedFolderName) detectedFolderName = entry.name;
        await collectImageFilesFromEntry(entry, fileMap, entry.name);
      } else if (entry.isFile) {
        const file: File | null = await new Promise((resolve) =>
          entry.file((f: File) => resolve(f), () => resolve(null))
        );
        if (file && isSupportedImageFile(file.name)) {
          fileMap.set((file as any).webkitRelativePath || file.name, file);
        }
      }
    }

    if (fileMap.size === 0) {
      for (const file of plainFiles) {
        if (isSupportedImageFile(file.name)) {
          fileMap.set((file as any).webkitRelativePath || file.name, file);
        }
      }
    }

    if (fileMap.size === 0) {
      // ⚠️ 画像が無いというだけで突き放さないこと。撮影ロールをセルの窓へ落とすのは
      // 自然な操作で、しかもロールウィンドウを閉じていると落とす先が他に無い。
      // ⚠️ plainFiles だけを見ないこと。フォルダを落とした場合そこにはフォルダ自体しか
      // 入っておらず、中の .mov / .mp4 が見えない。ハンドルとエントリも渡して中を探す。
      const videos = await collectDroppedVideoFiles(plainFiles, handles, entries);
      if (videos.length > 0) {
        /**
         * ⚠️ 落とした窓に合わせて面を決めること (Win A → ロール A / Win B → ロール B)。
         * 「今アクティブなロール」にしていた頃は、2 画面で見比べようと Win B へ
         * 落としてもロール A が差し替わり、ロール B へ入れる手段が無かった
         * (2026-08-31 の報告)。
         */
        const targetRoll: RollId = isWinA ? 'rollA' : 'rollB';
        loadRollFiles(targetRoll, videos, commonRootName(videos));
        return;
      }
      alert(
        'ドロップされた中に画像ファイル (.tga / .png / .jpg) が見つかりませんでした。\n' +
          '撮影ロールは .mov / .mp4 に対応しています。'
      );
      return;
    }

    const fileList = sortNatural(fileMap.keys());
    const folderTitle = detectedFolderName || (isWinA ? 'ドロップフォルダ A' : 'ドロップフォルダ B');
    if (isWinA) setCustomDropFolderA(folderTitle, fileMap, fileList);
    else setCustomDropFolderB(folderTitle, fileMap, fileList);
  };
  return {
    isWinADragOver,
    isWinBDragOver,
    handleWindowDragEnter,
    handleWindowDragOver,
    handleWindowDragLeave,
    handleFolderOrFilesNativeDrop,
  };
}
