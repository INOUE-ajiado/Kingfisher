/**
 * 「どの版の、どんな環境で起きたのか」を 1 行にする。
 *
 * ⚠️ ログを解析するとき、これが無いと毎回そこから聞き直すことになる。
 * 実際に何度も「直した版で試していますか」を確かめられずに詰まった (2026-09-03)。
 * ⚠️ ここは環境が無い場所 (テスト・ワーカー) でも落ちないこと。
 */

/** 差し替えできるようにしておく (テスト用) */
export interface BuildEnv {
  scripts?: string[];
  hardwareConcurrency?: number;
  deviceMemory?: number;
  screen?: { width: number; height: number };
  devicePixelRatio?: number;
  hasWorker?: boolean;
  hasOffscreenCanvas?: boolean;
  hasFileSystemAccess?: boolean;
  language?: string;
}

/**
 * 動いている版。
 *
 * 本番は assets/index-XXXX.js のハッシュがそのまま版になる。
 * ⚠️ 開発サーバーではハッシュが付かないので、その旨を書くこと。
 * 「直った版で試したのか」を取り違えないため。
 */
export function describeBuild(env: BuildEnv): string {
  const bundle = (env.scripts ?? []).map((src) => src.split('/').pop() ?? '').find((n) => /^index-.+\.js$/.test(n));

  if (bundle) return `版: ${bundle}`;
  if ((env.scripts ?? []).some((s) => /\/src\/main\.tsx|@vite/.test(s))) return '版: 開発ビルド (ハッシュなし)';
  return '版: 不明';
}

/**
 * 速さと機能に関わる環境。
 *
 * ⚠️ 並列の本数はコア数で決まる。遅いという報告を読むとき、
 * ここが分からないと「8 本で並行」の意味が変わる。
 */
export function describeEnvironment(env: BuildEnv): string {
  const parts = [
    `コア ${env.hardwareConcurrency ?? '?'}`,
    env.deviceMemory ? `メモリ ${env.deviceMemory}GB` : null,
    env.screen ? `画面 ${env.screen.width}x${env.screen.height}` : null,
    env.devicePixelRatio && env.devicePixelRatio !== 1 ? `倍率 ${env.devicePixelRatio}` : null,
    `担当 ${env.hasWorker ? '可' : '不可'}`,
    `OffscreenCanvas ${env.hasOffscreenCanvas ? '可' : '不可'}`,
    `フォルダ書き込み ${env.hasFileSystemAccess ? '可' : '不可'}`,
  ].filter(Boolean);

  return `環境: ${parts.join(' / ')}`;
}

/** 実行中のブラウザから集める */
export function readBuildEnv(): BuildEnv {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return {};

  return {
    scripts: Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).src),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory,
    screen: typeof screen !== 'undefined' ? { width: screen.width, height: screen.height } : undefined,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : undefined,
    hasWorker: typeof Worker !== 'undefined',
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    hasFileSystemAccess: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
    language: navigator.language,
  };
}
