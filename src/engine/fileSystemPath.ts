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

/**
 * Kingfisher が読み込める画像。
 *
 * ⚠️ 拡張子の判定は必ずここを通すこと。
 * 以前は経路ごとに条件が散っており (`.tga` のみ / `.tga` と `.jpg` だけ /
 * 4 種すべて)、同じフォルダでも開き方によって .png が見えたり見えなかったりした。
 */
export const SUPPORTED_IMAGE_PATTERN = /\.(tga|png|jpe?g)$/i;

export function isSupportedImageFile(fileName: string): boolean {
  return SUPPORTED_IMAGE_PATTERN.test(fileName);
}

/**
 * ディレクトリハンドルを再帰的に走査し、ルートからの相対パスをキーにして集める。
 *
 * ⚠️ `basePath` にはルートフォルダ名から始まるパスを渡すこと。
 * ここで作るキーと、ストアが持つフォルダハンドルの起点が一致していないと
 * resolveFileHandle() がディレクトリを辿れず、読み込みも保存も失敗する。
 *
 * 1 階層しか見ない実装だとサブフォルダの中の画像がツリーにも出ないため、
 * 走査は必ずこの関数に任せる。
 */
export async function collectImageFilesRecursively(
  dirHandle: any,
  basePath: string,
  filesMap: Map<string, File>
): Promise<void> {
  for await (const entry of dirHandle.values()) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      if (!isSupportedImageFile(entry.name)) continue;
      try {
        filesMap.set(entryPath, await entry.getFile());
      } catch (e) {
        // 読めなかったファイルは一覧にも載せない。
        // 載せるとツリーには出るのに開けない項目になる。
        console.error(`Failed to read ${entryPath}:`, e);
      }
    } else if (entry.kind === 'directory') {
      await collectImageFilesRecursively(entry, entryPath, filesMap);
    }
  }
}
