/**
 * File System Access API 上で「相対パス」からファイルを引くためのヘルパー。
 *
 * ファイルツリーを階層表示するため、ファイルの識別子には
 * `Cat/a/A0001.tga` のようなルートからの相対パスを使う。
 * 一方 getFileHandle() は名前を 1 つしか受け取れないため、
 * ディレクトリを 1 段ずつ辿る必要がある。
 */

/** 相対パスをセグメントへ分解する。先頭がルートフォルダ名なら取り除く */
export function splitFilePath(path: string, rootFolderName?: string | null): string[] {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length > 1 && rootFolderName && parts[0] === rootFolderName) parts.shift();
  return parts;
}

/**
 * ルートのディレクトリハンドルから、相対パスのファイルハンドルを取得する。
 * パス区切りを含まない場合は従来どおり直下のファイルとして扱う。
 */
export async function resolveFileHandle(
  rootHandle: any,
  path: string,
  rootFolderName?: string | null,
  options?: { create?: boolean }
): Promise<any> {
  const parts = splitFilePath(path, rootFolderName);
  if (parts.length === 0) throw new Error(`Invalid file path: ${path}`);

  let dir = rootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  return dir.getFileHandle(parts[parts.length - 1], options);
}
