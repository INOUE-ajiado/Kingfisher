/**
 * 選んだファイルを「新しいフォルダへまとめる」ための下ごしらえ。
 *
 * ⚠️ ここは実際のファイル操作をしない。どこへ何という名前で移すかを決め、
 * 移せない理由があれば先に全部返す。制作データを触る処理は、
 * 1 件も動かさずに中止できる形にしておく (リネームと同じ考え方)。
 */

/** 相対パスのフォルダ部分 ("Cut/a/x.tga" -> "Cut/a") */
function dirOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)));
  return idx < 0 ? '' : path.slice(0, idx);
}

/** 相対パスのファイル名 ("Cut/a/x.tga" -> "x.tga") */
function nameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)));
  return idx < 0 ? path : path.slice(idx + 1);
}

export interface MoveToFolderPlanItem {
  /** 今のパス */
  from: string;
  /** 移した後のパス */
  to: string;
}

export interface MoveToFolderPlan {
  /** 新しいフォルダの相対パス */
  folderPath: string;
  items: MoveToFolderPlanItem[];
  /** 実行できない理由。1 つでもあれば実行しない */
  problems: string[];
}

/** フォルダ名として使えるか (OS とブラウザの両方で通る範囲に絞る) */
export function invalidFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'フォルダ名が空です';
  if (/[\\/:*?"<>|]/.test(trimmed)) return 'フォルダ名に使えない文字が入っています (\\ / : * ? " < > |)';
  if (trimmed === '.' || trimmed === '..') return 'フォルダ名が不正です';
  if (trimmed.length > 80) return 'フォルダ名が長すぎます (80 文字まで)';
  return null;
}

/**
 * 移動の計画を立てる。
 *
 * ⚠️ 新しいフォルダは「選んだファイルの置き場所」に作る。全部が同じフォルダに
 * あるならその中、ばらけているならルート直下。勝手に別の場所へ動かさない。
 * ⚠️ 同じ名前のファイルが 2 つ以上入るなら中止する。move() は黙って上書きするので、
 * 実行前に気づかないと片方が消える。
 * ⚠️ 既にそのフォルダの中にあるファイルは、動かす必要がないので計画から外す。
 */
export function buildMoveToFolderPlan(
  paths: string[],
  folderName: string,
  existingPaths: string[]
): MoveToFolderPlan {
  const problems: string[] = [];
  const trimmed = folderName.trim();

  const nameProblem = invalidFolderName(trimmed);
  if (nameProblem) problems.push(nameProblem);

  if (paths.length === 0) problems.push('まとめる対象がありません');

  const dirs = Array.from(new Set(paths.map(dirOf)));
  const baseDir = dirs.length === 1 ? dirs[0] : '';

  /**
   * ⚠️ 置き場所がもう同じ名前のフォルダなら、その中に同名のフォルダを掘らない。
   * 「ボツ」の中身を選び直して「ボツ」にまとめようとしたときに、
   * ボツ/ボツ ができてしまう。
   */
  const alreadyThere = baseDir !== '' && nameOf(baseDir) === trimmed;
  const folderPath = alreadyThere ? baseDir : baseDir ? `${baseDir}/${trimmed}` : trimmed;

  const items: MoveToFolderPlanItem[] = [];
  const seen = new Map<string, string>();

  paths.forEach((from) => {
    const name = nameOf(from);
    const to = `${folderPath}/${name}`;

    if (from === to) return; // すでにそのフォルダの中

    const already = seen.get(name);
    if (already) {
      problems.push(`同じ名前のファイルが重なります: ${name} (${already} と ${from})`);
      return;
    }
    seen.set(name, from);
    items.push({ from, to });
  });

  // 移動先に同名のファイルが既にあるか
  const existing = new Set(existingPaths);
  items.forEach((item) => {
    if (existing.has(item.to) && !paths.includes(item.to)) {
      problems.push(`移動先に同じ名前のファイルがあります: ${item.to}`);
    }
  });

  if (items.length === 0 && problems.length === 0) {
    problems.push('すでにそのフォルダの中にあります');
  }

  return { folderPath, items, problems };
}

/** 移動後の一覧を作る (移したものだけ差し替える) */
export function applyMoveToList(list: string[], items: MoveToFolderPlanItem[]): string[] {
  const moved = new Map(items.map((item) => [item.from, item.to]));
  return list.map((path) => moved.get(path) ?? path);
}
