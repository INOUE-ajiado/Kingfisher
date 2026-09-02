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
 * ⚠️ 期限は数秒しかない。名前を尋ねる prompt や確認の confirm を挟むと、
 * 読み終えて入力するあいだに切れる。ダイアログを出す操作は、
 * 押された時点で先に許可を取ってから尋ねること (2026-09-02 の報告)。
 */
export interface WriteAccessResult {
  ok: boolean;
  /** 断られた・失敗した理由 (ログと画面に出す) */
  reason?: string;
  /** 許可を求めるダイアログを実際に出したか */
  asked?: boolean;
}

/**
 * 書き込み許可の確認と要求。理由つきで返す。
 *
 * ⚠️ ここから例外を投げないこと。requestPermission() は期限切れの操作から呼ぶと
 * 例外になる (Chrome: User activation is required to request permissions)。
 * 投げたままにすると呼び出し側の await が抜け、画面にもログにも何も出ないまま
 * 操作が消える。実際に「まとめる: 要求 42 件」の次が 1 行も無い、という形で起きた。
 */
export async function requestWriteAccess(handle: any): Promise<WriteAccessResult> {
  // 対応していない環境では判定できないので、そのまま書き込みを試させる
  if (!handle) return { ok: false, reason: 'フォルダが開かれていません' };
  if (typeof handle.queryPermission !== 'function') return { ok: true };

  const options = { mode: 'readwrite' as const };

  try {
    if ((await handle.queryPermission(options)) === 'granted') return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: `許可の状態を確認できませんでした: ${err?.message || err}` };
  }

  if (typeof handle.requestPermission !== 'function') {
    return { ok: false, reason: 'この環境では書き込み許可を求められません' };
  }

  try {
    const state = await handle.requestPermission(options);
    return state === 'granted'
      ? { ok: true, asked: true }
      : { ok: false, asked: true, reason: `書き込みが許可されませんでした (${state})` };
  } catch (err: any) {
    const name = err?.name ? `${err.name}: ` : '';
    return {
      ok: false,
      asked: true,
      reason:
        `${name}${err?.message || err}` +
        ' — 許可を求められるのはボタンを押した直後の数秒だけです。もう一度操作してください',
    };
  }
}

/** 真偽だけ欲しい場面向け。⚠️ 例外は投げない */
export async function ensureWritePermission(handle: any): Promise<boolean> {
  return (await requestWriteAccess(handle)).ok;
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

/** 同じディレクトリにファイルを複製する */
export async function copyFile(
  rootHandle: any,
  path: string,
  newName: string,
  rootFolderName?: string | null
): Promise<void> {
  const { dir, name } = await resolveParentDirectory(rootHandle, path, rootFolderName);

  const source = await dir.getFileHandle(name);
  const buffer = await (await source.getFile()).arrayBuffer();

  const target = await dir.getFileHandle(newName, { create: true });
  const writable = await target.createWritable();
  await writable.write(buffer);
  await writable.close();
}

/** ファイルを削除する */
export async function deleteFile(
  rootHandle: any,
  path: string,
  rootFolderName?: string | null
): Promise<void> {
  const { dir, name } = await resolveParentDirectory(rootHandle, path, rootFolderName);
  await dir.removeEntry(name);
}

/**
 * FileSystemEntry のディレクトリを最後まで読み切る。
 *
 * ⚠️ readEntries() は 1 回の呼び出しで最大 100 件しか返さない仕様なので、
 * 空配列が返るまで繰り返すこと。1 回で済ませると大きなカットフォルダの
 * ファイルが黙って欠落する。
 */
export async function readAllDirectoryEntries(dirReader: any): Promise<any[]> {
  const all: any[] = [];
  for (;;) {
    const batch: any[] = await new Promise((resolve) => {
      dirReader.readEntries(
        (results: any[]) => resolve(results),
        () => resolve([])
      );
    });
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
}

/** getAsFileSystemHandle() を待つ上限 (ms) */
const DROP_HANDLE_TIMEOUT_MS = 3000;

/**
 * ドロップされた項目の FileSystemHandle を、期限を切って集める。
 *
 * ⚠️ getAsFileSystemHandle() をそのまま await しないこと。
 * 解決しないまま返ってこないことがある (ヘッドレスの Chrome で実測)。
 * Promise.all で待つとドロップ処理ごと止まり、エラーも出さずに黙って終わるため、
 * 「フォルダを落としたのに何も起きない」という最悪の見え方になる。
 *
 * 期限内に取れなかったものは捨てる。呼び出し側は webkitGetAsEntry() の
 * 読み取り専用エントリへ落ちればよい (保存はできないが読み込みはできる)。
 */
export async function resolveDropHandles(
  handlePromises: Promise<any>[],
  timeoutMs: number = DROP_HANDLE_TIMEOUT_MS
): Promise<any[]> {
  if (handlePromises.length === 0) return [];

  const guarded = handlePromises.map((p) =>
    Promise.race([
      p.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])
  );
  return (await Promise.all(guarded)).filter(Boolean);
}

/**
 * 相対パスのフォルダを、途中を作りながら辿る。
 * 「新しいフォルダにまとめる」のように、まだ無いフォルダへ書く場面で使う。
 */
export async function ensureDirectory(
  rootHandle: any,
  dirPath: string,
  rootFolderName?: string | null
): Promise<any> {
  const parts = splitFilePath(dirPath, rootFolderName, rootHandle?.name);

  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

/**
 * ファイルを別のフォルダへ移す。
 *
 * move(dir, name) があればそれを使う (Chromium 111+)。中身を読み書きしないので速く、
 * 大きなスキャンでも一瞬で終わる。無い環境は「コピー → 元を削除」で代替する。
 * ⚠️ move() は移動先の同名ファイルを黙って上書きする。呼び出し側は
 * 衝突を事前に潰しておくこと (buildMoveToFolderPlan)。
 */
export async function moveFileToDirectory(
  rootHandle: any,
  path: string,
  targetDirPath: string,
  rootFolderName?: string | null
): Promise<void> {
  const { dir, name } = await resolveParentDirectory(rootHandle, path, rootFolderName);
  const fileHandle = await dir.getFileHandle(name);
  const targetDir = await ensureDirectory(rootHandle, targetDirPath, rootFolderName);

  if (typeof fileHandle.move === 'function') {
    await fileHandle.move(targetDir, name);
    return;
  }

  const buffer = await (await fileHandle.getFile()).arrayBuffer();
  const target = await targetDir.getFileHandle(name, { create: true });
  const writable = await target.createWritable();
  await writable.write(buffer);
  await writable.close();
  // ⚠️ 書き切ってから消す。逆にすると失敗したときに元が残らない
  await dir.removeEntry(name);
}

/**
 * 相対パスの途中のフォルダを作りながら、書き込み先のファイルを用意する。
 *
 * ⚠️ ルート名で始まるパスは 1 段落とすこと。ハンドルはそのルートを指しているので、
 * 落とさないと「Cut の中の Cut」を作ってしまう (resolveFileHandle と同じ約束)。
 */
export async function createFileIn(dirHandle: any, path: string, rootName?: string | null): Promise<any> {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (rootName && parts.length > 1 && parts[0] === rootName) parts.shift();

  let dir = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  return dir.getFileHandle(parts[parts.length - 1], { create: true });
}

/** 上書きの前に残す控えの名前 (a0001.tga → a0001_orig.tga) */
export function backupPathFor(path: string): string {
  return path.replace(/(\.[^.]+)$/, '_orig$1');
}

/**
 * そのファイル自身が控えか。
 *
 * ⚠️ 控えの控え (_orig_orig) を作らないこと。控えはもともと手つかずの 1 枚なので、
 * それを上書きする前にもう 1 枚作っても意味がなく、フォルダが二重に膨らむだけ
 * (2026-09-02 に実データで発生)。
 */
export function isBackupPath(path: string): boolean {
  return /_orig(\.[^.]+)?$/i.test(path);
}
