/**
 * 操作ログ (DEBUG ウィンドウ用)。
 *
 * 「どのファイルへ移ったか」「どの窓が開いたか」を後から追えるようにするためのもの。
 * 不具合の報告と突き合わせるので、数字 (位置・枚数・コマ差) を必ず入れること。
 *
 * ⚠️ ストア (zustand) の中に置かないこと。ログを 1 行足すたびにストアが更新され、
 * 購読しているパネルが軒並み再描画される。塗り作業中のコマ送りは 1 秒に何度も走るので、
 * ここが再描画の原因になる。外に置き、DEBUG ウィンドウだけが
 * useSyncExternalStore で購読する。
 * ⚠️ 毎コマ走る場所 (ロールの requestVideoFrameCallback、キャンバスの描画ループ) から
 * 呼ばないこと。ログが埋まって肝心の操作が流れる。
 */

export type DebugLogCategory = 'cell' | 'roll' | 'folder' | 'window' | 'sync' | 'file' | 'view';

/** 目立たせたい行 (食い違いの検出など) */
export type DebugLogLevel = 'info' | 'warn';

/**
 * 再生の自動送り。
 * ⚠️ これを源とするコマ移動は記録しないこと。毎コマ走るのでログが埋まる。
 */
export const PLAYBACK_SOURCE = '再生の自動送り';

export interface DebugLogEntry {
  /** 通し番号。表示にもコピーにも使う */
  seq: number;
  /** 記録した時刻 (epoch ミリ秒) */
  at: number;
  category: DebugLogCategory;
  level: DebugLogLevel;
  message: string;
  /** 位置・パスなどの内訳 */
  detail?: string;
}

/**
 * 保持する上限。古いものから捨てる。
 * ⚠️ 無制限にしないこと。開きっぱなしで何時間も作業する使い方なので、
 * 際限なく貯めるとメモリを食い、コピーしても長すぎて読めない。
 */
const MAX_ENTRIES = 500;

let entries: DebugLogEntry[] = [];
let seq = 0;
/** 上限を超えて捨てた件数。解析するとき「途中が欠けている」ことを伝えるため */
let dropped = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

/** 1 行記録する */
export function logDebug(
  category: DebugLogCategory,
  message: string,
  detail?: string,
  level: DebugLogLevel = 'info'
): void {
  seq += 1;
  const entry: DebugLogEntry = { seq, at: Date.now(), category, level, message, detail };
  // ⚠️ 配列を作り直すこと。useSyncExternalStore は参照が変わらないと描き直さない
  if (entries.length >= MAX_ENTRIES) dropped += 1;
  entries = entries.length >= MAX_ENTRIES ? [...entries.slice(1), entry] : [...entries, entry];
  emit();
}

export function clearDebugLog(): void {
  entries = [];
  dropped = 0;
  emit();
}

export function getDebugLog(): DebugLogEntry[] {
  return entries;
}

export function subscribeDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 時刻を HH:MM:SS.mmm で */
export function formatLogTime(at: number): string {
  const d = new Date(at);
  const pad = (v: number, n = 2) => String(v).padStart(n, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * 続けて同じことが起きた行をまとめる。
 *
 * ⚠️ 畳まないと上限 500 行がすぐ埋まる。「端なので動かさない」が 10 連続するような
 * 場面が実際にあり、肝心の操作が流れてしまう (2026-09-03 のログ)。
 * ⚠️ 何回起きたか、最初と最後がいつかは必ず残すこと。回数そのものが手がかりになる。
 */
export interface CollapsedEntry {
  entry: DebugLogEntry;
  count: number;
  lastAt: number;
}

export function collapseRepeats(list: DebugLogEntry[]): CollapsedEntry[] {
  const out: CollapsedEntry[] = [];

  list.forEach((entry) => {
    const prev = out[out.length - 1];
    const same =
      prev &&
      prev.entry.category === entry.category &&
      prev.entry.level === entry.level &&
      prev.entry.message === entry.message &&
      prev.entry.detail === entry.detail;

    if (same) {
      prev.count += 1;
      prev.lastAt = entry.at;
      return;
    }
    out.push({ entry, count: 1, lastAt: entry.at });
  });

  return out;
}

/** カテゴリごとの件数 (どこで何が起きたかの当たりをつける) */
export function tallyByCategory(list: DebugLogEntry[]): string {
  const counts = new Map<string, number>();
  let warns = 0;
  list.forEach((e) => {
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    if (e.level === 'warn') warns += 1;
  });

  const parts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`);
  return `内訳: ${parts.join(' / ')}${warns > 0 ? ` (うち注意 ${warns})` : ''}`;
}

/**
 * 全文をテキストにする (解析用のコピー)。
 *
 * 先頭に環境と件数を入れる。ログだけ貼られても、いつ・どの版で起きたのかが
 * 分からないと追えないため。
 */
export function formatDebugLog(options?: { entries?: DebugLogEntry[]; notes?: string[] }): string {
  const target = options?.entries ?? entries;
  const collapsed = collapseRepeats(target);
  const startedAt = target.length > 0 ? target[0].at : 0;

  const head = [
    `# Kingfisher 操作ログ`,
    `日時: ${new Date().toLocaleString('ja-JP')}`,
    `件数: ${target.length}${target.length !== entries.length ? ` (全 ${entries.length} 件のうち)` : ''} (上限 ${MAX_ENTRIES})` +
      (dropped > 0 ? ` ⚠️ 古い ${dropped} 件は上限で捨てました` : '') +
      (collapsed.length !== target.length ? ` / 繰り返しをまとめて ${collapsed.length} 行` : ''),
    ...(target.length > 0 ? [tallyByCategory(target)] : []),
    // ⚠️ 絞り込みと今の状態を必ず添えること。行だけ貼られても前提が分からない
    ...(options?.notes ?? []),
    `URL: ${typeof location !== 'undefined' ? location.href : '-'}`,
    `UA: ${typeof navigator !== 'undefined' ? navigator.userAgent : '-'}`,
    '',
  ];

  const body = collapsed.map(({ entry: e, count, lastAt }) => {
    // 食い違いの行は ! を付けて、目で追えるようにする
    const mark = e.level === 'warn' ? '!' : ' ';
    // ⚠️ 最初の行からの経過も出すこと。どこで待たされたかが一目で分かる
    const elapsed = `+${((e.at - startedAt) / 1000).toFixed(2)}s`;
    const repeat = count > 1 ? ` ×${count} (最後 ${formatLogTime(lastAt)})` : '';
    const line =
      `[${formatLogTime(e.at)} ${elapsed}]${mark}#${String(e.seq).padStart(4, '0')}` +
      ` [${e.category.padEnd(6)}] ${e.message}${repeat}`;
    return e.detail ? `${line}\n${' '.repeat(24)}${e.detail}` : line;
  });

  return [...head, ...(body.length > 0 ? body : ['(ログはありません)'])].join('\n');
}
