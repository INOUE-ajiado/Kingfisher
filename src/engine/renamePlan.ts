/**
 * ファイル名の変更計画を組み立てる純粋ロジック。
 *
 * 実際の書き換え (File System Access API) からは切り離してある。
 * 制作データを壊す操作なので、「何がどう変わるか」と「衝突が起きるか」を
 * 実行前に確定できることを最優先にしている。
 */

/** 連番リネームの設定 */
export interface SequentialRenameOptions {
  /** 先頭に付ける共通テキスト */
  prefix: string;
  /** 拡張子の手前に付ける共通テキスト */
  suffix: string;
  /** 連番の開始値 */
  startNumber: number;
  /** 連番の桁数 (足りない分を 0 で埋める) */
  digits: number;
  /** 連番の刻み。既定は 1 */
  step?: number;
}

export interface RenamePlanItem {
  /** 元の識別子 (ルートからの相対パス) */
  path: string;
  /** 元のファイル名 */
  from: string;
  /** 変更後のファイル名 */
  to: string;
}

export interface RenameConflict {
  to: string;
  reason: 'duplicate' | 'exists';
}

/** 相対パスからファイル名だけを取り出す */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** ファイル名を「拡張子より前」と「拡張子」に分ける (拡張子が無ければ空文字) */
export function splitExtension(fileName: string): { stem: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  // 先頭のドットは隠しファイル扱いで拡張子とみなさない
  if (dot <= 0) return { stem: fileName, ext: '' };
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot) };
}

/** 相対パスの中のファイル名だけを差し替える */
export function replaceBaseName(path: string, newName: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx < 0 ? newName : path.slice(0, idx + 1) + newName;
}

/**
 * 連番リネームの計画を組み立てる。
 *
 * 渡された順序がそのまま連番の順序になるので、呼び出し側で並べておくこと。
 * 拡張子は元のファイルのものを引き継ぐ (.tga を .png に変えたりはしない)。
 * 桁数より大きい番号は切り捨てず、そのまま伸ばす。
 */
export function buildSequentialRenamePlan(
  paths: string[],
  options: SequentialRenameOptions
): RenamePlanItem[] {
  const step = options.step ?? 1;
  const digits = Math.max(0, Math.floor(options.digits));

  return paths.map((path, i) => {
    const from = baseName(path);
    const { ext } = splitExtension(from);
    const num = options.startNumber + i * step;
    const padded = String(Math.abs(num)).padStart(digits, '0');
    const signed = num < 0 ? `-${padded}` : padded;
    return { path, from, to: `${options.prefix}${signed}${options.suffix}${ext}` };
  });
}

/** 単体リネームの計画 (拡張子を省略されたら元のものを補う) */
export function buildSingleRenamePlan(path: string, newName: string): RenamePlanItem {
  const from = baseName(path);
  const trimmed = newName.trim();
  const { ext } = splitExtension(from);
  const hasExt = splitExtension(trimmed).ext !== '';
  return { path, from, to: hasExt ? trimmed : `${trimmed}${ext}` };
}

/**
 * ファイル名として使えないものを洗い出す。
 *
 * 先頭がドットの名前も弾く。splitExtension は隠しファイルとして正しく扱うが、
 * セル画像としては意図した名前になり得ない (プレフィックスを消したときに
 * `.tga` だけが残る、など)。
 */
export function findInvalidNames(plan: RenamePlanItem[]): RenamePlanItem[] {
  // Windows / macOS の双方で問題になる文字と、空名を弾く
  const invalid = /[\\/:*?"<>|]/;
  return plan.filter((item) => {
    const name = item.to.trim();
    return name === '' || name.startsWith('.') || invalid.test(name) || splitExtension(name).stem === '';
  });
}

/**
 * 実行前に衝突を洗い出す。
 *
 * - duplicate: 計画の中で同じ名前が 2 つ以上できてしまう
 * - exists: 計画に含まれない既存ファイルと同じ名前になる
 *
 * 計画の中で「別のファイルの元の名前」と衝突するのは、番号をずらすだけの
 * リネームで普通に起きる。これは一時名を経由すれば成立するので衝突としない。
 */
export function findRenameConflicts(
  plan: RenamePlanItem[],
  existingPaths: string[]
): RenameConflict[] {
  const conflicts: RenameConflict[] = [];

  const seen = new Set<string>();
  for (const item of plan) {
    if (seen.has(item.to)) conflicts.push({ to: item.to, reason: 'duplicate' });
    seen.add(item.to);
  }

  // 同じディレクトリにある、リネーム対象ではないファイル
  const movingFrom = new Set(plan.map((i) => i.path));
  const outsiders = new Set(
    existingPaths.filter((p) => !movingFrom.has(p)).map((p) => baseName(p))
  );

  const planDirs = new Set(plan.map((i) => replaceBaseName(i.path, '')));
  for (const item of plan) {
    if (!outsiders.has(item.to)) continue;
    // 別ディレクトリの同名は衝突しない
    const collides = existingPaths.some(
      (p) => !movingFrom.has(p) && baseName(p) === item.to && planDirs.has(replaceBaseName(p, ''))
    );
    if (collides) conflicts.push({ to: item.to, reason: 'exists' });
  }

  return conflicts;
}

/**
 * 計画の中で名前が入れ替わる (別のファイルの元名を奪う) かどうか。
 * true なら一時名を経由する 2 段階リネームが必要。
 */
export function needsTwoPhaseRename(plan: RenamePlanItem[]): boolean {
  const sources = new Set(plan.map((i) => i.from));
  return plan.some((i) => i.to !== i.from && sources.has(i.to));
}

/** 実際に名前が変わる項目だけを残す */
export function omitUnchanged(plan: RenamePlanItem[]): RenamePlanItem[] {
  return plan.filter((item) => item.from !== item.to);
}

/**
 * 複製に付ける名前を決める。
 *
 * 既存と衝突しないところまで連番を伸ばす (_copy → _copy2 → _copy3)。
 * 衝突したまま書き込むと元のファイルを潰すので、必ずここを通すこと。
 */
export function buildDuplicateName(fileName: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  const { stem, ext } = splitExtension(fileName);

  let candidate = `${stem}_copy${ext}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${stem}_copy${n}${ext}`;
    n += 1;
  }
  return candidate;
}

/**
 * 複数ファイルの複製計画を組み立てる。
 * 生成した名前も「使用済み」に加えていくので、計画内で衝突しない。
 */
export function buildDuplicatePlan(paths: string[], existingPaths: string[]): RenamePlanItem[] {
  const taken = new Set(existingPaths.map(baseName));
  return paths.map((path) => {
    const from = baseName(path);
    const to = buildDuplicateName(from, taken);
    taken.add(to);
    return { path, from, to };
  });
}
