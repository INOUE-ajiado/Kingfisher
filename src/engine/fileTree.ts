/**
 * ルートからの相対パスの一覧を、階層ツリーへ組み立てる。
 *
 * セルのファイルツリーとロールの一覧の両方で使う。
 * 表示側の都合を持ち込まない純粋な変換なので、engine 側に置いている。
 */

export interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  /** ファイルの場合、渡された配列の中での位置 */
  fileIndex?: number;
  children?: FileTreeNode[];
}

/**
 * 相対パスの並びからツリーを作る。
 *
 * ⚠️ 並び順は渡された配列のまま。連番順にしたい場合は呼び出し側で
 * sortNatural を通してから渡すこと (素の sort だと a1, a10, a2 と並ぶ)。
 */
export function buildTreeFromPaths(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  paths.forEach((fullPath, originalIdx) => {
    const parts = fullPath.split(/[/\\]/);
    let currentLevel = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      let existingNode = currentLevel.find((node) => node.name === part);

      if (!existingNode) {
        existingNode = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          isFolder: !isLast,
          fileIndex: isLast ? originalIdx : undefined,
          children: isLast ? undefined : [],
        };
        currentLevel.push(existingNode);
      }

      if (!isLast && existingNode.children) {
        currentLevel = existingNode.children;
      }
    });
  });

  return root;
}
