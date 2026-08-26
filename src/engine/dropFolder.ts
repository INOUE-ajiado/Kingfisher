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
