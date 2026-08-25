/**
 * カットフォルダ (ルート) を走査して、サブフォルダの一覧を組み立てる。
 *
 * ⚠️ この処理は「メニューバー > フォルダを開く」と
 * 「ファイルブラウザ > カットフォルダを開く」の 2 箇所から呼ばれる。
 * 以前はそれぞれが自前で走査しており、同じフォルダを開いても
 * 経路によって結果が違っていた (下の 2 点)。走査は必ずここに任せること。
 *
 * 1. サブフォルダが無いフォルダを開いたとき、片方は setFolderHandleA だけを
 *    呼んでいた。setFolderHandleA は rootFolderName / availableSubDirectories /
 *    selectedSubDirA を触らないため、前に開いたカットのサブフォルダ一覧が
 *    ドロップダウンに残り、選ぶと前のカットのファイルへ飛んでいた。
 * 2. 画像フォルダかどうかの判定に `.tga` と `.png` だけの独自正規表現を
 *    使っていた (.jpg が漏れる)。拡張子の判定は isSupportedImageFile に一本化してある。
 */

import { collectImageFilesRecursively } from './fileSystemPath';

/** store の SubDirectoryItem と同じ形。engine から store へは依存させない */
export interface ScannedSubDirectory {
  name: string;
  handle: any;
  filesMap: Map<string, File>;
  fileList: string[];
  isImageFolder: boolean;
}

/** 直下の画像を 1 つのサブフォルダとして扱うときの名前 */
export const ROOT_SUBDIR_NAME = '(Root)';

/** `_` で始まるフォルダを先に、あとは名前順に並べる */
function compareSubDirNames(a: string, b: string): number {
  if (a.startsWith('_') && !b.startsWith('_')) return -1;
  if (!a.startsWith('_') && b.startsWith('_')) return 1;
  return a.localeCompare(b);
}

/**
 * ルートのハンドルからサブフォルダの一覧を作る。
 *
 * - 直下のディレクトリごとに、その配下すべてを再帰的に集める
 * - 画像が 1 つも無いディレクトリは載せない (開けない項目を作らないため)
 * - サブフォルダが無く直下に画像がある場合は `(Root)` 1 件として返す
 * - どこにも画像が無ければ空配列。呼び出し側でユーザーに伝えること
 *
 * ⚠️ 相対パスは必ずルートフォルダ名から始め、ハンドルはサブフォルダではなく
 * ルートを持たせる。ここが食い違うと resolveFileHandle() がディレクトリを
 * 辿れず、読み込みは filesMap のフォールバックで通るのに保存だけ落ちる。
 */
export async function scanCutRootFolder(
  rootHandle: any,
  rootName: string
): Promise<ScannedSubDirectory[]> {
  const subDirs: ScannedSubDirectory[] = [];

  for await (const entry of rootHandle.values()) {
    if (entry.kind !== 'directory') continue;

    const filesMap = new Map<string, File>();
    await collectImageFilesRecursively(entry, `${rootName}/${entry.name}`, filesMap);
    if (filesMap.size === 0) continue;

    subDirs.push({
      name: entry.name,
      handle: rootHandle,
      filesMap,
      fileList: Array.from(filesMap.keys()).sort(),
      // collectImageFilesRecursively は対応拡張子しか集めないので、
      // 1 件でも入っていれば画像フォルダ
      isImageFolder: true,
    });
  }

  if (subDirs.length > 0) {
    subDirs.sort((a, b) => compareSubDirNames(a.name, b.name));
    return subDirs;
  }

  const rootFiles = new Map<string, File>();
  await collectImageFilesRecursively(rootHandle, rootName, rootFiles);
  if (rootFiles.size === 0) return [];

  return [
    {
      name: ROOT_SUBDIR_NAME,
      handle: rootHandle,
      filesMap: rootFiles,
      fileList: Array.from(rootFiles.keys()).sort(),
      isImageFolder: true,
    },
  ];
}
