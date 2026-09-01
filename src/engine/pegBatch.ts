/**
 * まとめて焼き込むときに、誤検出だけを弾く。
 *
 * 同じカットのスキャンは同じ機械で同じように取り込まれるので、
 * 補正量はほぼ揃うのが正しい姿 (実データで X ≈ +18〜20px / 回転 ≈ 0.03° / 倍率 ≈ 99.9%)。
 * そこから大きく外れた 1 枚は、タップ穴ではないものを穴と見なした結果である。
 *
 * ⚠️ 外れ値をそのまま焼き込まないこと。元に戻せない上に、
 * 「42 枚のうち数枚だけ絵がずれている」という一番気づきにくい壊れ方になる
 * (2026-09-02 の実データで X -322px や Y -1174px / 回転 -5.8° が焼き込まれた)。
 */

import { PegTransform } from './pegStabilizer';

export interface PegCandidate {
  path: string;
  transform: PegTransform;
  /**
   * 基準との並びの違い。
   * ⚠️ 平行移動しか補正しない以上、傾きや間隔のずれは直せない。
   * だからこそ「大きく違う = 穴を取り違えている」の判断材料として要る。
   */
  angleDiff?: number;
  spacingRatio?: number;
}

export interface PegRejection {
  path: string;
  reason: string;
}

export interface PegBatchCheck {
  accepted: PegCandidate[];
  rejected: PegRejection[];
  /** 判断のもとにした中央値 (ログに出す) */
  median: { offsetX: number; offsetY: number; angleDiff: number; spacingRatio: number } | null;
}

export interface PegBatchLimits {
  /** 中央値からどれだけ離れたら誤検出とみなすか */
  offsetPx: number;
  rotationDeg: number;
  scale: number;
  /** 中央値を信用するのに必要な枚数 */
  minForMedian: number;
  /** 枚数によらず、これを超えたら誤検出とみなす */
  absRotationDeg: number;
  absScale: number;
}

export const DEFAULT_PEG_LIMITS: PegBatchLimits = {
  offsetPx: 40,
  rotationDeg: 0.5,
  scale: 0.005,
  minForMedian: 5,
  absRotationDeg: 3,
  absScale: 0.03,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 「18.3px」のように読みやすく */
function px(v: number): string {
  return `${Math.round(v * 10) / 10}px`;
}

/**
 * 揃っていない 1 枚を見つけて外す。
 *
 * ⚠️ 平均ではなく中央値で見ること。外れ値は平均を引っ張るので、
 * 数枚まぎれるだけで「全部が外れ値」に見えてしまう。
 * ⚠️ 枚数が少ないときは中央値を信用しないこと (minForMedian)。
 * 3 枚のうち 1 枚が誤検出だと、どちらが正しいか決められない。
 * その場合でも、明らかにおかしい値 (絶対の上限) だけは弾く。
 */
export function rejectPegOutliers(
  candidates: PegCandidate[],
  limits: PegBatchLimits = DEFAULT_PEG_LIMITS
): PegBatchCheck {
  const accepted: PegCandidate[] = [];
  const rejected: PegRejection[] = [];

  if (candidates.length === 0) return { accepted, rejected, median: null };

  const useMedian = candidates.length >= limits.minForMedian;
  const med = useMedian
    ? {
        offsetX: median(candidates.map((c) => c.transform.offsetX)),
        offsetY: median(candidates.map((c) => c.transform.offsetY)),
        angleDiff: median(candidates.map((c) => c.angleDiff ?? 0)),
        spacingRatio: median(candidates.map((c) => c.spacingRatio ?? 1)),
      }
    : null;

  candidates.forEach((candidate) => {
    const t = candidate.transform;
    const reasons: string[] = [];

    // 枚数によらない上限。紙を置き直しても、この幅を超えることはない
    const angleDiff = candidate.angleDiff ?? 0;
    const spacingRatio = candidate.spacingRatio ?? 1;
    if (Math.abs(angleDiff) > limits.absRotationDeg) {
      reasons.push(`穴の並びが基準と ${angleDiff.toFixed(2)}° 違います`);
    }
    if (Math.abs(spacingRatio - 1) > limits.absScale) {
      reasons.push(`穴の間隔が基準の ${(spacingRatio * 100).toFixed(2)}% しかありません`);
    }

    if (med) {
      if (Math.abs(t.offsetX - med.offsetX) > limits.offsetPx) {
        reasons.push(`横のずれ ${px(t.offsetX)} が他の ${px(med.offsetX)} と食い違います`);
      }
      if (Math.abs(t.offsetY - med.offsetY) > limits.offsetPx) {
        reasons.push(`縦のずれ ${px(t.offsetY)} が他の ${px(med.offsetY)} と食い違います`);
      }
      if (Math.abs(angleDiff - med.angleDiff) > limits.rotationDeg) {
        reasons.push(`穴の並び ${angleDiff.toFixed(3)}° が他の ${med.angleDiff.toFixed(3)}° と食い違います`);
      }
    }

    if (reasons.length > 0) rejected.push({ path: candidate.path, reason: reasons.join(' / ') });
    else accepted.push(candidate);
  });

  return { accepted, rejected, median: med };
}
