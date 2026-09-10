/**
 * ドロップされたものを読み取って、「開いたフォルダ」の中身にまとめる。
 *
 * ⚠️ 走査はここに一本化すること。Win A / Win B へ落とす経路と、
 * 何もないところへ落とす経路で別々に書くと、同じフォルダでも落とす場所によって
 * 見えるファイルが違う、という状態になる (拡張子の判定が散っていた頃と同じ轍)。
 *
 * ⚠️ dataTransfer.items はハンドラを抜けた時点で無効になる。
 * 呼び出し側は readDropItems で同期的に読み取ってから渡すこと。
 */

import {
  collectImageFilesRecursively,
  isSupportedImageFile,
  readAllDirectoryEntries,
  resolveDropHandles,
} from './fileSystemPath';
import { collectDroppedVideoFiles, DroppedVideo } from './videoSource';
import { sortNatural } from './naturalOrder';
import { logDebug } from './debugLog';
import { usePaintStore } from '../store/usePaintStore';

/** ドロップ直後に同期で読み取っておくもの */
export interface DropItems {
  plainFiles: File[];
  handlePromises: Promise<any>[];
  entries: any[];
}

/**
 * dataTransfer から必要なものを同期的に取り出す。
 *
 * ⚠️ await を挟む前に呼ぶこと。items はハンドラを抜けると無効になり、
 * 複数まとめて落としたときに 2 件目以降を取りこぼす。
 */
export function readDropItems(dataTransfer: DataTransfer | null): DropItems {
  const plainFiles = dataTransfer?.files ? Array.from(dataTransfer.files) : [];
  const entries: any[] = [];
  const handlePromises: Promise<any>[] = [];

  const items = dataTransfer?.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item: any = items[i];
      if (typeof item.getAsFileSystemHandle === 'function') {
        handlePromises.push(item.getAsFileSystemHandle().catch(() => null));
      }
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
  }

  return { plainFiles, handlePromises, entries };
}

export interface DroppedFolder {
  /** 書き込み可能なディレクトリハンドル。取れなければ null (読み込み専用) */
  dirHandle: any | null;
  /** 表示に使うフォルダ名 */
  folderName: string;
  /** ルートからの相対パスをキーにした画像 */
  images: Map<string, File>;
  /** 同じフォルダで見つかった映像 */
  videos: DroppedVideo[];
}

/** FileSystemEntry のディレクトリを辿って画像を集める (読み込み専用の経路) */
async function collectImagesFromEntry(
  dirEntry: any,
  currentPath: string,
  images: Map<string, File>
): Promise<void> {
  const entries = await readAllDirectoryEntries(dirEntry.createReader());

  for (const entry of entries) {
    const relPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      if (!isSupportedImageFile(entry.name)) continue;
      const file: File | null = await new Promise((resolve) =>
        entry.file((f: File) => resolve(f), () => resolve(null))
      );
      if (file) images.set(relPath, file);
    } else if (entry.isDirectory) {
      await collectImagesFromEntry(entry, relPath, images);
    }
  }
}

/**
 * ドロップされたものを読み取る。
 *
 * 書き込み可能なハンドルが取れればそれを優先する。取れない環境 (Firefox / Safari) では
 * 読み取り専用のエントリへ落ちる。保存はできないが読み込みはできる。
 */
export async function readDroppedFolder(items: DropItems): Promise<DroppedFolder> {
  const { plainFiles, handlePromises, entries } = items;

  const handles = await resolveDropHandles(handlePromises);
  const dirHandle = handles.find((h: any) => h?.kind === 'directory') ?? null;

  const images = new Map<string, File>();
  let folderName = '';

  if (dirHandle) {
    folderName = dirHandle.name;
    await collectImageFilesRecursively(dirHandle, dirHandle.name, images);
  }

  if (images.size === 0) {
    for (const entry of entries) {
      if (!entry?.isDirectory) continue;
      if (!folderName) folderName = entry.name;
      await collectImagesFromEntry(entry, entry.name, images);
    }
  }

  // フォルダではなく画像を直接落とされた場合
  if (images.size === 0) {
    for (const file of plainFiles) {
      if (isSupportedImageFile(file.name)) {
        images.set((file as any).webkitRelativePath || file.name, file);
      }
    }
  }

  const videos = await collectDroppedVideoFiles(plainFiles, handles, entries);
  if (!folderName && videos.length > 0 && videos[0].path.includes('/')) {
    folderName = videos[0].path.split('/')[0];
  }

  return { dirHandle, folderName, images, videos };
}

export interface ProcessMultiFolderResult {
  handled: boolean;
  error?: 'too_many_folders' | 'mismatch' | 'empty' | null;
}

interface SingleFolderContent {
  dirHandle: any | null;
  folderName: string;
  images: Map<string, File>;
  videos: DroppedVideo[];
}

async function readSingleDroppedFolder(
  target: { kind: 'handle'; handle: any; name: string } | { kind: 'entry'; entry: any; name: string },
  plainFiles: File[]
): Promise<SingleFolderContent> {
  const images = new Map<string, File>();
  const folderName = target.name;

  if (target.kind === 'handle') {
    const dirHandle = target.handle;
    await collectImageFilesRecursively(dirHandle, dirHandle.name, images);
    const videos = await collectDroppedVideoFiles(plainFiles, [dirHandle], []);
    return { dirHandle, folderName, images, videos };
  } else {
    await collectImagesFromEntry(target.entry, target.entry.name, images);
    const videos = await collectDroppedVideoFiles(plainFiles, [], [target.entry]);
    return { dirHandle: null, folderName, images, videos };
  }
}

function classifyFolderKind(content: SingleFolderContent): 'image' | 'video' | 'empty' {
  const imgCount = content.images.size;
  const vidCount = content.videos.length;

  if (imgCount > 0 && vidCount === 0) return 'image';
  if (vidCount > 0 && imgCount === 0) return 'video';
  if (imgCount > 0 && vidCount > 0) return imgCount >= vidCount ? 'image' : 'video';
  return 'empty';
}

/**
 * 複数フォルダが同時にドロップされた場合の自動2画面制御。
 *
 * 【ルール】
 * ・フォルダが3つ以上選択された場合：「フォルダの挿入は２フォルダまでです」
 * ・画像フォルダと画像フォルダ：WinAとWinBで自動2画面表示
 * ・ロール映像フォルダとロール映像フォルダ：ロールAとロールBで自動2画面表示
 * ・画像フォルダとロール映像フォルダ：種別不一致エラー「フォルダの種別不一致エラー / フォルダを確認してください」
 */
export async function readMultipleDroppedFolders(
  items: DropItems,
  store: any
): Promise<ProcessMultiFolderResult> {
  const { plainFiles, handlePromises, entries } = items;
  const handles = await resolveDropHandles(handlePromises);

  const dirHandles = handles.filter((h: any) => h?.kind === 'directory');
  const dirEntries = entries.filter((e: any) => e?.isDirectory);

  let topFolders: Array<
    | { kind: 'handle'; handle: any; name: string }
    | { kind: 'entry'; entry: any; name: string }
  > = [];

  if (dirHandles.length >= 2) {
    topFolders = dirHandles.map((h: any) => ({ kind: 'handle', handle: h, name: h.name }));
  } else if (dirEntries.length >= 2) {
    topFolders = dirEntries.map((e: any) => ({ kind: 'entry', entry: e, name: e.name }));
  } else if (dirHandles.length === 1) {
    topFolders = dirHandles.map((h: any) => ({ kind: 'handle', handle: h, name: h.name }));
  } else if (dirEntries.length === 1) {
    topFolders = dirEntries.map((e: any) => ({ kind: 'entry', entry: e, name: e.name }));
  }

  // 1. 3つ以上のフォルダが選択されてドロップされた場合
  if (topFolders.length >= 3) {
    alert('フォルダの挿入は２フォルダまでです');
    logDebug('folder', `マルチフォルダドロップエラー: ${topFolders.length}個のフォルダがドロップされました (上限2個)`);
    return { handled: true, error: 'too_many_folders' };
  }

  // 2. 2つのフォルダが選択されてドロップされた場合
  if (topFolders.length === 2) {
    const [c1, c2] = await Promise.all([
      readSingleDroppedFolder(topFolders[0], plainFiles),
      readSingleDroppedFolder(topFolders[1], plainFiles),
    ]);

    const type1 = classifyFolderKind(c1);
    const type2 = classifyFolderKind(c2);

    if (type1 === 'empty' || type2 === 'empty') {
      alert(
        'ドロップされた中に開けるファイルが見つかりませんでした。\n' +
          'セル画像 (.tga / .png / .jpg / .psd / .pdf) と撮影ロール (.mov / .mp4) に対応しています。'
      );
      return { handled: true, error: 'empty' };
    }

    // 画像フォルダと画像フォルダの場合 (WinA / WinB で自動2画面表示)
    if (type1 === 'image' && type2 === 'image') {
      const files1 = sortNatural(c1.images.keys());
      const files2 = sortNatural(c2.images.keys());

      if (c1.dirHandle) store.setFolderHandleA(c1.dirHandle, c1.folderName, files1, c1.images);
      else store.setCustomDropFolderA(c1.folderName, c1.images, files1);

      if (c2.dirHandle) store.setFolderHandleB(c2.dirHandle, c2.folderName, files2, c2.images);
      else store.setCustomDropFolderB(c2.folderName, c2.images, files2);

      usePaintStore.setState({ isWinAVisible: true, isSplitView: true, activeSurface: 'cell' });
      logDebug('folder', `2つの画像フォルダを2画面へ自動表示: WinA (${c1.folderName}), WinB (${c2.folderName})`);
      return { handled: true };
    }

    // ロール映像フォルダとロール映像フォルダの場合 (ロールA / ロールB で自動2画面表示)
    if (type1 === 'video' && type2 === 'video') {
      store.loadRollFiles('rollA', c1.videos, c1.folderName);
      if (c1.videos.length > 0) store.selectRollFile('rollA', c1.videos[0].path);

      store.loadRollFiles('rollB', c2.videos, c2.folderName);
      if (c2.videos.length > 0) store.selectRollFile('rollB', c2.videos[0].path);

      store.openRollWindow();
      logDebug('folder', `2つのロール映像フォルダを2画面へ自動表示: RollA (${c1.folderName}), RollB (${c2.folderName})`);
      return { handled: true };
    }

    // 画像フォルダとロール映像フォルダの場合 (フォルダの種別不一致)
    if ((type1 === 'image' && type2 === 'video') || (type1 === 'video' && type2 === 'image')) {
      alert('フォルダの種別不一致エラー\n\nフォルダを確認してください');
      logDebug('folder', `フォルダの種別不一致エラー: folder1=${type1}, folder2=${type2}`);
      return { handled: true, error: 'mismatch' };
    }
  }

  return { handled: false };
}

