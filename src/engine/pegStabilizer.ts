/**
 * タップ穴の自動検出と、基準コマへ合わせるための補正量の算出。
 *
 * オートフィードのスキャナで作画用紙を取り込むと、タップ穴の位置が 1 枚ごとに
 * 微妙にずれる。そのずれを揃えるための仕組み
 * (OLM Digital の PegHoleStabilizer と同じ目的。あちらは Windows の実行ファイルのみで
 * ソースは公開されていないため、ここは Kingfisher 独自の実装)。
 *
 * ⚠️ 画の中の黒を拾わないこと。探すのは紙の端 (上タップなら上端) の帯だけ。
 * 全面を走査すると、線画の濃い部分を穴と誤検出する。
 * ⚠️ 穴は「暗い画素」で探すこと。Kingfisher は純白を透明として読み込むので
 * (decodeTGA の規則)、紙の地の方が alpha 0 になる。透明を穴とみなすと、
 * 紙全体がひとつの塊になって何も見つからない (2026-08-31 に実際に踏んだ)。
 * ⚠️ ただし「抜いた穴が透明」で入ってくる素材もあるため、暗い画素で見つからなければ
 * 透明を穴とみなす読み方も試す。
 * ⚠️ 4K のセルでも重くならないよう、間引いた格子の上で連結成分を作る。
 * 穴の直径は紙幅の数 % あるので、間引いても形は保てる。
 */

/** 見つかった 1 つの穴 */
export interface PegHole {
  /** 重心 (元画像の画素座標) */
  x: number;
  y: number;
  /** 外接矩形の大きさ */
  width: number;
  height: number;
  /** 画素数 (元画像の画素に換算) */
  area: number;
}

export interface PegDetection {
  detected: boolean;
  status: 'success' | 'failed';
  /** 左 → 中央 → 右 の順。見つからなければ空 */
  holes: PegHole[];
  /** 中央の穴 (合わせる基準点) */
  center: { x: number; y: number };
  /** 左右の穴を結ぶ線の傾き (度)。右下がりが正 */
  angle: number;
  /** 中央から左右までの平均距離 (px) */
  spacing: number;
  /** どちらの端で見つけたか */
  edge: 'top' | 'bottom';
  /** うまくいかなかった理由。黙って失敗しないための説明 */
  message: string;
}

/** 合わせ先。ふつうは 1 枚目の検出結果をそのまま使う */
export interface PegReference {
  center: { x: number; y: number };
  angle: number;
  spacing: number;
}

export interface PegTransform {
  offsetX: number;
  offsetY: number;
  /** 度。表示側は画像の中心を軸に回す */
  rotation: number;
}

export interface PegDetectOptions {
  /** これ以下の明るさ (0-255) を穴とみなす */
  threshold?: number;
  /** 端から何割を探すか (0.28 なら上端から 28%) */
  searchRatio?: number;
  /** 走査に使う格子の目安の長辺 (px)。大きい画像はここまで間引く */
  sampleTarget?: number;
}

const DEFAULTS = {
  threshold: 70,
  searchRatio: 0.28,
  sampleTarget: 1400,
};

const failed = (message: string, edge: 'top' | 'bottom' = 'top'): PegDetection => ({
  detected: false,
  status: 'failed',
  holes: [],
  center: { x: 0, y: 0 },
  angle: 0,
  spacing: 0,
  edge,
  message,
});

interface Blob {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  touchesSide: boolean;
}

/**
 * 帯の中から穴らしい塊を拾う。
 *
 * ⚠️ 紙の外に出る縁 (スキャナの影) を拾わないこと。左右の端に接する塊は落とす。
 */
type HoleLook = 'dark' | 'transparent';

function findBlobs(
  data: Uint8ClampedArray,
  width: number,
  fromY: number,
  toY: number,
  threshold: number,
  step: number,
  look: HoleLook
): Blob[] {
  const gw = Math.floor(width / step);
  const gh = Math.floor((toY - fromY) / step);
  if (gw < 8 || gh < 4) return [];

  const mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y = fromY + gy * step;
    for (let gx = 0; gx < gw; gx++) {
      const idx = (y * width + gx * step) * 4;
      const a = data[idx + 3];
      const isHole =
        look === 'dark'
          ? a > 0 && (data[idx] + data[idx + 1] + data[idx + 2]) / 3 <= threshold
          : a === 0;
      if (isHole) mask[gy * gw + gx] = 1;
    }
  }

  const seen = new Uint8Array(gw * gh);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = gw;
    let maxX = -1;
    let minY = gh;
    let maxY = -1;

    while (stack.length > 0) {
      const at = stack.pop()!;
      const gx = at % gw;
      const gy = (at - gx) / gw;

      count += 1;
      sumX += gx;
      sumY += gy;
      if (gx < minX) minX = gx;
      if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy;
      if (gy > maxY) maxY = gy;

      // 4 近傍
      if (gx > 0 && mask[at - 1] && !seen[at - 1]) { seen[at - 1] = 1; stack.push(at - 1); }
      if (gx < gw - 1 && mask[at + 1] && !seen[at + 1]) { seen[at + 1] = 1; stack.push(at + 1); }
      if (gy > 0 && mask[at - gw] && !seen[at - gw]) { seen[at - gw] = 1; stack.push(at - gw); }
      if (gy < gh - 1 && mask[at + gw] && !seen[at + gw]) { seen[at + gw] = 1; stack.push(at + gw); }
    }

    blobs.push({
      x: (sumX / count) * step,
      y: fromY + (sumY / count) * step,
      width: (maxX - minX + 1) * step,
      height: (maxY - minY + 1) * step,
      area: count * step * step,
      touchesSide: minX === 0 || maxX === gw - 1,
    });
  }

  return blobs;
}

/** 穴らしい大きさ・形かどうか */
function looksLikeHole(blob: Blob, width: number): boolean {
  if (blob.touchesSide) return false;
  const minSide = width * 0.006;
  const maxSide = width * 0.09;
  if (blob.width < minSide || blob.width > maxSide) return false;
  if (blob.height < minSide * 0.6 || blob.height > maxSide) return false;
  const aspect = blob.width / Math.max(1, blob.height);
  // 丸穴も長円 (中央) も通す。極端に細長い帯は落とす
  return aspect >= 0.2 && aspect <= 6;
}

/**
 * 3 つ組を選ぶ。
 *
 * タップ穴は「中央 + 左右」で、ほぼ一直線・ほぼ左右対称に並ぶ。
 * その形に一番近い組を選び、当てはまりの悪さを点数にする。
 */
function pickTriple(candidates: Blob[], width: number): { holes: Blob[]; score: number } | null {
  const sorted = [...candidates].sort((a, b) => b.area - a.area).slice(0, 40).sort((a, b) => a.x - b.x);
  if (sorted.length < 3) return null;

  let best: { holes: Blob[]; score: number } | null = null;

  for (let i = 0; i < sorted.length - 2; i++) {
    for (let j = i + 1; j < sorted.length - 1; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        const left = sorted[i];
        const mid = sorted[j];
        const right = sorted[k];

        const span = right.x - left.x;
        if (span < width * 0.2) continue; // 近すぎる 3 つは穴の並びではない

        const dLeft = mid.x - left.x;
        const dRight = right.x - mid.x;
        const symmetry = Math.abs(dLeft - dRight) / span;
        if (symmetry > 0.25) continue;

        // 中央が左右を結ぶ線からどれだけ離れているか (直線性)
        const t = (mid.x - left.x) / span;
        const lineY = left.y + (right.y - left.y) * t;
        const straightness = Math.abs(mid.y - lineY) / span;
        if (straightness > 0.06) continue;

        const areas = [left.area, mid.area, right.area];
        const sizeRatio = Math.max(...areas) / Math.max(1, Math.min(...areas));
        if (sizeRatio > 8) continue;

        const score = symmetry * 3 + straightness * 6 + (sizeRatio - 1) * 0.05;
        if (!best || score < best.score) best = { holes: [left, mid, right], score };
      }
    }
  }

  return best;
}

function toHole(blob: Blob): PegHole {
  return { x: blob.x, y: blob.y, width: blob.width, height: blob.height, area: blob.area };
}

/**
 * タップ穴を探す。
 *
 * 上端の帯で見つからなければ下端も試す (下タップの紙があるため)。
 */
export function detectPegHoles(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: PegDetectOptions = {}
): PegDetection {
  if (!data || width <= 0 || height <= 0 || data.length < width * height * 4) {
    return failed('画像がありません');
  }

  const threshold = options.threshold ?? DEFAULTS.threshold;
  const searchRatio = options.searchRatio ?? DEFAULTS.searchRatio;
  const sampleTarget = options.sampleTarget ?? DEFAULTS.sampleTarget;
  const step = Math.max(1, Math.round(Math.max(width, height) / sampleTarget));

  const bandHeight = Math.max(8, Math.floor(height * searchRatio));
  const bands: { edge: 'top' | 'bottom'; fromY: number; toY: number }[] = [
    { edge: 'top', fromY: 0, toY: Math.min(height, bandHeight) },
    { edge: 'bottom', fromY: Math.max(0, height - bandHeight), toY: height },
  ];

  let lastMessage = 'タップ穴が見つかりませんでした';

  // ⚠️ 「暗い穴」を先に試し、見つからなければ「透明な穴」で読み直す。
  // 素材によってどちらで入ってくるか決まらないため
  const looks: HoleLook[] = ['dark', 'transparent'];

  for (const look of looks) {
  for (const band of bands) {
    const blobs = findBlobs(data, width, band.fromY, band.toY, threshold, step, look);
    const candidates = blobs.filter((b) => looksLikeHole(b, width));

    if (candidates.length < 3) {
      lastMessage = `穴らしい形が ${candidates.length} 個しか見つかりませんでした (${band.edge === 'top' ? '上端' : '下端'}の帯 / ${look === 'dark' ? '暗い穴' : '透明な穴'}として走査 / 塊 ${blobs.length} 個)`;
      continue;
    }

    const picked = pickTriple(candidates, width);
    if (!picked) {
      lastMessage = `穴の候補は ${candidates.length} 個ありましたが、タップの並び (左右対称・一直線) に合う 3 つがありませんでした`;
      continue;
    }

    const [left, mid, right] = picked.holes;
    const angle = (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
    const spacing = (mid.x - left.x + (right.x - mid.x)) / 2;

    return {
      detected: true,
      status: 'success',
      holes: [toHole(left), toHole(mid), toHole(right)],
      center: { x: mid.x, y: mid.y },
      angle: Math.round(angle * 1000) / 1000,
      spacing: Math.round(spacing * 10) / 10,
      edge: band.edge,
      message: `${band.edge === 'top' ? '上端' : '下端'}で 3 つの穴を検出 (間隔 ${Math.round(spacing)}px / 傾き ${angle.toFixed(2)}°)`,
    };
  }
  }

  return failed(lastMessage);
}

/** 検出結果を、そのまま合わせ先として使う */
export function referenceFromDetection(detection: PegDetection): PegReference {
  return { center: { ...detection.center }, angle: detection.angle, spacing: detection.spacing };
}

/**
 * 検出結果を基準へ重ねるための補正量。
 *
 * ⚠️ 表示側は「画像の中心を軸に回してから平行移動」する順で描く。
 * 平行移動の量は、回したあとの穴の位置から求めること。先に引き算すると、
 * 傾きがあるときに合わない。
 */
export function pegTransformTo(
  detection: PegDetection,
  reference: PegReference,
  width: number,
  height: number
): PegTransform {
  if (!detection.detected) return { offsetX: 0, offsetY: 0, rotation: 0 };

  const rotation = reference.angle - detection.angle;
  const rad = (rotation * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;

  const dx = detection.center.x - cx;
  const dy = detection.center.y - cy;
  const rotatedX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
  const rotatedY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);

  return {
    offsetX: Math.round((reference.center.x - rotatedX) * 10) / 10,
    offsetY: Math.round((reference.center.y - rotatedY) * 10) / 10,
    rotation: Math.round(rotation * 1000) / 1000,
  };
}
