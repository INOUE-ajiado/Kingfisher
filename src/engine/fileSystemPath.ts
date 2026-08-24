/**
 * File System Access API 上で「相対パス」からファイルを引くためのヘルパー。
 *
 * ファイルツリーを階層表示するため、ファイルの識別子には
 * `Cat/a/A0001.tga` のようなルートからの相対パスを使う。
 * 一方 getFileHandle() は名前を 1 つしか受け取れないため、
 * ディレクトリを 1 段ずつ辿る必要がある。
 */

/**
 * 相対パスをセグメントへ分解する。先頭が起点フォルダ名なら取り除く。
 *
 * ⚠️ 起点の候補を複数受け取る。開く経路によってパスの先頭が
 * 「カットのルート名」だったり「選んだ / ドロップしたフォルダ名」だったりするため、
 * 呼び出し側は分かっている候補をすべて渡す (最初に一致したものを剥がす)。
 */
export function splitFilePath(path: string, ...rootNames: (string | null | undefined)[]): string[] {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length > 1 && rootNames.some((name) => !!name && parts[0] === name)) parts.shift();
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
  // ハンドル自身の名前も起点候補にする。パスが「選んだフォルダ名/…」で
  // 始まる経路 (Open A/B・ドラッグ＆ドロップ) はこれが無いと辿れない。
  const parts = splitFilePath(path, rootFolderName, rootHandle?.name);
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

/**
 * 書き込み許可を確認し、必要なら要求する。
 *
 * showDirectoryPicker() も drag & drop も、既定では読み取り許可しか付かない。
 * その状態で createWritable() を呼ぶと NotAllowedError になるため、
 * 保存の直前にここを通す。
 *
 * ⚠️ requestPermission() はユーザー操作の直後にしか通らない。
 * 保存ボタンや Ctrl+S から連なる呼び出しの中で使うこと。
 */
export async function ensureWritePermission(handle: any): Promise<boolean> {
  // 対応していない環境では判定できないので、そのまま書き込みを試させる
  if (!handle || typeof handle.queryPermission !== 'function') return true;

  const options = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  if (typeof handle.requestPermission !== 'function') return false;
  return (await handle.requestPermission(options)) === 'granted';
}

/**
 * 相対パスの「親ディレクトリのハンドル」と「ファイル名」を返す。
 * リネームや削除のように、ディレクトリ側の操作が要る場面で使う。
 */
export async function resolveParentDirectory(
  rootHandle: any,
  path: string,
  rootFolderName?: string | null
): Promise<{ dir: any; name: string }> {
  const parts = splitFilePath(path, rootFolderName, rootHandle?.name);
  if (parts.length === 0) throw new Error(`Invalid file path: ${path}`);

  let dir = rootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  return { dir, name: parts[parts.length - 1] };
}

/**
 * ファイル名を変更する。
 *
 * FileSystemFileHandle.move() があればそれを使う (Chromium 111+)。
 * 無い環境では「新しい名前でコピー → 元を削除」で代替する。
 * ⚠️ 代替経路は途中で失敗すると両方残る / 元が消えるので、
 * 呼び出し側は衝突を事前に潰しておくこと。
 */
export async function renameFile(
  rootHandle: any,
  path: string,
  newName: string,
  rootFolderName?: string | null
): Promise<void> {
  const { dir, name } = await resolveParentDirectory(rootHandle, path, rootFolderName);
  if (name === newName) return;

  const fileHandle = await dir.getFileHandle(name);

  if (typeof fileHandle.move === 'function') {
    await fileHandle.move(newName);
    return;
  }

  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  const target = await dir.getFileHandle(newName, { create: true });
  const writable = await target.createWritable();
  await writable.write(buffer);
  await writable.close();
  await dir.removeEntry(name);
}
