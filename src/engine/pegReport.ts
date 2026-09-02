/**
 * タップ補正の結果を、精度を詰めるための数値にまとめる。
 *
 * ⚠️ 「合った / 合わなかった」だけでは追えない。1 枚ごとの補正量と、
 * 束全体のばらつき (中央値・範囲・散らばり) が並んで初めて、
 * 「検出がぶれているのか」「紙が本当にずれているのか」を切り分けられる
 * (2026-09-02 のユーザー指定)。
 */

export interface PegSample {
  path: string;
  offsetX: number;
  offsetY: number;
  /** 基準との穴の並びの差 (度) */
  angleDiff: number;
  /** 基準との穴の間隔の比 */
  spacingRatio: number;
}

export interface PegSpread {
  count: number;
  median: number;
  min: number;
  max: number;
  /** 中央値からの散らばり (中央絶対偏差)。外れ値に引っ張られない */
  deviation: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * ばらつきを測る。
 *
 * ⚠️ 平均と標準偏差を使わないこと。誤検出が 1 枚混ざるだけで、
 * どちらも大きく動いて「全体がぶれている」ように見えてしまう。
 * 中央値と中央絶対偏差なら、外れ値があっても本体の姿が残る。
 */
export function spreadOf(values: number[]): PegSpread {
  if (values.length === 0) return { count: 0, median: 0, min: 0, max: 0, deviation: 0 };

  const med = median(values);
  return {
    count: values.length,
    median: med,
    min: Math.min(...values),
    max: Math.max(...values),
    deviation: median(values.map((v) => Math.abs(v - med))),
  };
}

/** 「中央値 0.02 / 範囲 -0.46〜0.45 / ばらつき 0.24」 */
export function formatSpread(spread: PegSpread, unit: string, digits = 2): string {
  const n = (v: number) => v.toFixed(digits);
  return `中央値 ${n(spread.median)}${unit} / 範囲 ${n(spread.min)}〜${n(spread.max)}${unit} / ばらつき ${n(spread.deviation)}${unit}`;
}

/**
 * 束全体の様子を数行にまとめる。
 *
 * ⚠️ 「ばらつき」と「範囲」を両方出すこと。ばらつきが小さいのに範囲が広ければ、
 * 大半は揃っていて数枚だけ外れている = 誤検出を疑う場面である。
 */
export function summarizePegBatch(samples: PegSample[]): string[] {
  if (samples.length === 0) return ['補正量を測れたコマがありません'];

  const x = spreadOf(samples.map((s) => s.offsetX));
  const y = spreadOf(samples.map((s) => s.offsetY));
  const angle = spreadOf(samples.map((s) => s.angleDiff));
  const spacing = spreadOf(samples.map((s) => s.spacingRatio * 100));

  const lines = [
    `横のずれ: ${formatSpread(x, 'px')}`,
    `縦のずれ: ${formatSpread(y, 'px')}`,
    `穴の並びの差: ${formatSpread(angle, '°', 4)}`,
    `穴の間隔の比: ${formatSpread(spacing, '%')}`,
  ];

  // 大きく外れている順に、上位だけ名指しする
  const worst = [...samples]
    .map((s) => ({ s, far: Math.hypot(s.offsetX - x.median, s.offsetY - y.median) }))
    .sort((a, b) => b.far - a.far)
    .filter((v) => v.far > 1)
    .slice(0, 5);

  if (worst.length > 0) {
    lines.push(
      `中央値から離れている順: ${worst
        .map((v) => `${v.s.path.split(/[/\\]/).pop()} (${v.far.toFixed(1)}px)`)
        .join(' / ')}`
    );
  }

  return lines;
}

export interface PegSize {
  path: string;
  width: number;
  height: number;
}

/**
 * 束のどのコマも切らずに収まる画寸を決める。
 *
 * ⚠️ 横長のコマ (オートフィードで長く取り込まれた素材) を絶対に切らないこと
 * (2026-09-02 のユーザー指定)。基準の 1 枚に合わせると、それより大きいコマが
 * 黙って切られる。実データでは右が最大 902px 落ちていた。
 * ⚠️ 幅と高さは別々に最大を取ること。「幅が最大のコマ」と「高さが最大のコマ」は
 * 別であることが多い (実データでは 3251x1640 と 2331x1657)。
 * ⚠️ 動かす分も足すこと。右へ動かすコマは、その分だけ余分に要る。
 */
export function unionCanvas(
  frames: { width: number; height: number; offsetX?: number; offsetY?: number }[]
): { width: number; height: number } {
  if (frames.length === 0) return { width: 0, height: 0 };

  let width = 0;
  let height = 0;
  frames.forEach((f) => {
    width = Math.max(width, f.width + Math.max(0, Math.round(f.offsetX ?? 0)));
    height = Math.max(height, f.height + Math.max(0, Math.round(f.offsetY ?? 0)));
  });
  return { width, height };
}

/** 揃える先に対して、どれだけ白で埋まるか */
export function describePadding(sizes: PegSize[], target: { width: number; height: number }): string {
  const padX = sizes.filter((s) => s.width < target.width).map((s) => target.width - s.width);
  const padY = sizes.filter((s) => s.height < target.height).map((s) => target.height - s.height);

  if (padX.length === 0 && padY.length === 0) return '全部が同じ画寸なので、埋める縁はありません';

  const parts: string[] = [];
  if (padX.length > 0) parts.push(`右を最大 ${Math.max(...padX)}px (${padX.length} 枚)`);
  if (padY.length > 0) parts.push(`下を最大 ${Math.max(...padY)}px (${padY.length} 枚)`);
  return `白で埋めます: ${parts.join(' / ')} (切り取りはありません)`;
}
