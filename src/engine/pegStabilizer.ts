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
  /**
   * 基準にしたコマの画寸。まとめて焼くときは、ここへ全部を揃える。
   *
   * ⚠️ 1 カットの全コマは同じ画寸である必要がある (重ねる・撮影する前提)。
   * スキャナの自動切り抜きで 1 枚ごとに幅が変わることがあり、
   * 穴が絶対座標で揃っていても、画寸が違うと表示や合成で飛んで見える
   * (2026-09-02 の実データで幅 2326〜2880px、画面上で約 190px ずれた)。
   */
  width?: number;
  height?: number;
}

/**
 * 補正量。
 *
 * ⚠️ 平行移動だけにすること。本家 (OLMPegHoleStabilizer) は回転も拡大縮小も持たない
 * (warpAffine も QTransform も呼んでおらず、QImage::scanLine で行を動かしているだけ)。
 * 回転を入れると、穴を取り違えたときに絵ごと大きく回してしまい、
 * 元に戻せない壊れ方になる (2026-09-02 に -5.79° を焼き込んで実際に起きた)。
 * rotation と scale は表示と記録のために残してあるが、常に 0 と 1 である。
 */
export interface PegTransform {
  offsetX: number;
  offsetY: number;
  /** 度。表示側は画像の中心を軸に回す */
  rotation: number;
  /**
   * 倍率。穴の間隔の比から求める (スキャナの送りむらで数 % 伸び縮みする)。
   * ⚠️ 大きく外れた値は使わないこと。穴を取り違えたときに絵ごと拡大してしまう。
   */
  scale: number;
}

export interface PegDetectOptions {
  /** これ以下の明るさ (0-255) を穴とみなす */
  threshold?: number;
  /** 端から何割を探すか (0.28 なら上端から 28%) */
  searchRatio?: number;
  /** 走査に使う格子の目安の長辺 (px)。大きい画像はここまで間引く */
  sampleTarget?: number;
  /**
   * しきい値を画像から見当づけるか。
   * ⚠️ false のときは threshold だけを使うこと。手で決めた値に勝手な候補を混ぜると、
   * 「この値でどう見えるか」を確かめられない。
   */
  autoThreshold?: boolean;
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

/**
 * 収縮 → 膨張 (オープニング) で、細かいゴミを落とす。
 *
 * 本家 (OLMPegHoleStabilizer) も erode / dilate を通してから連結成分を数えている。
 * 線画の点や紙のゴミが穴の候補に混ざるのを防ぐのが目的。
 *
 * ⚠️ 消えすぎたら元に戻すこと。間引いた格子では 1 マスが元の step px にあたるので、
 * 小さめのスキャンだと穴そのものが消えてしまう。消えたら掛けない方がまし。
 */
function openMask(mask: Uint8Array, gw: number, gh: number): Uint8Array {
  const eroded = new Uint8Array(mask.length);
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const at = y * gw + x;
      // 十字の 4 近傍が全部埋まっているところだけ残す
      if (mask[at] && mask[at - 1] && mask[at + 1] && mask[at - gw] && mask[at + gw]) eroded[at] = 1;
    }
  }

  let left = 0;
  for (let i = 0; i < eroded.length; i++) left += eroded[i];
  if (left === 0) return mask; // 消えすぎ。掛けないでおく

  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const at = y * gw + x;
      if (!eroded[at]) continue;
      dilated[at] = 1;
      if (x > 0) dilated[at - 1] = 1;
      if (x < gw - 1) dilated[at + 1] = 1;
      if (y > 0) dilated[at - gw] = 1;
      if (y < gh - 1) dilated[at + gw] = 1;
    }
  }
  return dilated;
}

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

  // 本家と同じく、数える前にゴミを落とす
  const cleaned = openMask(mask, gw, gh);

  const seen = new Uint8Array(gw * gh);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < cleaned.length; start++) {
    if (!cleaned[start] || seen[start]) continue;

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
      if (gx > 0 && cleaned[at - 1] && !seen[at - 1]) { seen[at - 1] = 1; stack.push(at - 1); }
      if (gx < gw - 1 && cleaned[at + 1] && !seen[at + 1]) { seen[at + 1] = 1; stack.push(at + 1); }
      if (gy > 0 && cleaned[at - gw] && !seen[at - gw]) { seen[at - gw] = 1; stack.push(at - gw); }
      if (gy < gh - 1 && cleaned[at + gw] && !seen[at + gw]) { seen[at + gw] = 1; stack.push(at + gw); }
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

/**
 * なぜ候補から外れたか。見つからないときの説明に使う。
 *
 * 本家 (OLMPegHoleStabilizer) の検証項目に合わせてある
 * (invalid width / invalid height / invalid area / invalid aspect ratio)。
 * ⚠️ 具体的な数値は本家から読み取れないので、こちらで決めた値である。
 */
type RejectReason = 'ok' | 'edge' | 'small' | 'large' | 'thin' | 'sparse';

/**
 * 穴らしい大きさ・形かどうか。
 *
 * ⚠️ 落とした理由を返すこと。「0 個でした」だけでは、しきい値が悪いのか
 * 大きさの見当が外れているのか分からず、次に何を直せばよいか決められない。
 */
function classifyBlob(blob: Blob, width: number): RejectReason {
  if (blob.touchesSide) return 'edge';
  const minSide = width * 0.006;
  const maxSide = width * 0.09;
  if (blob.width < minSide || blob.height < minSide * 0.6) return 'small';
  if (blob.width > maxSide || blob.height > maxSide) return 'large';
  const aspect = blob.width / Math.max(1, blob.height);
  // 丸穴も長円 (中央) も通す。極端に細長い帯は落とす
  if (aspect < 0.2 || aspect > 6) return 'thin';

  /**
   * 面積の検証。穴は塗り潰された塊なので、囲みの中がほぼ埋まっている。
   * ⚠️ 線画が輪になっただけの部分を落とすためにここが要る
   * (大きさも縦横比も穴とよく似てしまう)。
   */
  const box = Math.max(1, blob.width * blob.height);
  if (blob.area / box < 0.45) return 'sparse';

  return 'ok';
}

/**
 * 帯の中の暗さから、しきい値を見当づける。
 *
 * ⚠️ 固定のしきい値だけにしないこと。スキャンの露出は素材ごとに違い、
 * 穴が真っ黒に出るとは限らない (灰色に出る紙がある / 2026-09-01 の報告)。
 * いちばん暗い側から数 % を穴の候補とみなす見当をつけ、そこから探す。
 */
function adaptiveThreshold(
  data: Uint8ClampedArray,
  width: number,
  fromY: number,
  toY: number,
  step: number
): number {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let y = fromY; y < toY; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) continue;
      const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      histogram[Math.max(0, Math.min(255, Math.round(lum)))] += 1;
      total += 1;
    }
  }
  if (total === 0) return DEFAULTS.threshold;

  // 暗い方から 3% ぶんを含む明るさ + 余裕
  const want = Math.max(1, Math.floor(total * 0.03));
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= want) return Math.max(30, Math.min(200, v + 12));
  }
  return DEFAULTS.threshold;
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

/**
 * 塊の重心を、元の解像度で取り直す。
 *
 * ⚠️ 間引いた格子の重心をそのまま使わないこと。大きなスキャンでは 2〜3px 刻みになり、
 * その誤差がそのまま補正のずれになる。塊の周りだけを 1px 刻みで見直せば、
 * 走査の重さは変わらないまま位置が細かく決まる。
 */
function refineHole(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  blob: Blob,
  threshold: number,
  look: HoleLook,
  step: number
): PegHole {
  const margin = step * 2;
  const fromX = Math.max(0, Math.floor(blob.x - blob.width / 2 - margin));
  const toX = Math.min(width - 1, Math.ceil(blob.x + blob.width / 2 + margin));
  const fromY = Math.max(0, Math.floor(blob.y - blob.height / 2 - margin));
  const toY = Math.min(height - 1, Math.ceil(blob.y + blob.height / 2 + margin));

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = toX;
  let maxX = fromX;
  let minY = toY;
  let maxY = fromY;

  for (let y = fromY; y <= toY; y++) {
    for (let x = fromX; x <= toX; x++) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      const isHole =
        look === 'dark'
          ? a > 0 && (data[idx] + data[idx + 1] + data[idx + 2]) / 3 <= threshold
          : a === 0;
      if (!isHole) continue;
      count += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (count === 0) {
    return { x: blob.x, y: blob.y, width: blob.width, height: blob.height, area: blob.area };
  }

  return {
    x: sumX / count,
    y: sumY / count,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area: count,
  };
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
  const autoThreshold = options.autoThreshold ?? true;
  const searchRatio = options.searchRatio ?? DEFAULTS.searchRatio;
  const sampleTarget = options.sampleTarget ?? DEFAULTS.sampleTarget;
  const step = Math.max(1, Math.round(Math.max(width, height) / sampleTarget));

  const bandHeight = Math.max(8, Math.floor(height * searchRatio));
  const bands: { edge: 'top' | 'bottom'; fromY: number; toY: number }[] = [
    { edge: 'top', fromY: 0, toY: Math.min(height, bandHeight) },
    { edge: 'bottom', fromY: Math.max(0, height - bandHeight), toY: height },
  ];

  /**
   * ⚠️ 1 通りで諦めないこと。素材によって、穴が黒く出るか透明で入るか、
   * どれだけ暗いかが違う。帯 (上/下) × 読み方 (暗い/透明) × しきい値 (自動/既定/緩め)
   * を順に試し、どこでどう落ちたかを説明として残す。
   */
  const looks: HoleLook[] = ['dark', 'transparent'];
  const tries: string[] = [];
  let bestNote = '';
  let bestCandidates = -1;

  for (const band of bands) {
  for (const look of looks) {
    const thresholds =
      look === 'transparent'
        ? [threshold]
        : autoThreshold
        ? Array.from(new Set([adaptiveThreshold(data, width, band.fromY, band.toY, step), threshold, 130]))
        : [threshold];

    for (const level of thresholds) {
      const blobs = findBlobs(data, width, band.fromY, band.toY, level, step, look);
      const reasons = { ok: 0, edge: 0, small: 0, large: 0, thin: 0, sparse: 0 };
      const candidates: Blob[] = [];
      blobs.forEach((b) => {
        const why = classifyBlob(b, width);
        reasons[why] += 1;
        if (why === 'ok') candidates.push(b);
      });

      const where = `${band.edge === 'top' ? '上端' : '下端'} / ${look === 'dark' ? `暗い穴 (${level} 以下)` : '透明な穴'}`;
      const note =
        `${where}: 塊 ${blobs.length} 個 → 穴らしい形 ${candidates.length} 個` +
        (blobs.length > 0
          ? ` (小さすぎ ${reasons.small} / 大きすぎ ${reasons.large} / 細長い ${reasons.thin} / 中身が薄い ${reasons.sparse} / 端に接触 ${reasons.edge})`
          : '');
      tries.push(note);
      if (candidates.length > bestCandidates) {
        bestCandidates = candidates.length;
        bestNote = note;
      }

      if (candidates.length < 3) continue;

      const picked = pickTriple(candidates, width);
      if (!picked) {
        tries[tries.length - 1] = `${note} — 左右対称・一直線に並ぶ 3 つがありません`;
        bestNote = tries[tries.length - 1];
        continue;
      }

      const refined = picked.holes.map((b) => refineHole(data, width, height, b, level, look, step));
      const [left, mid, right] = refined;
    const angle = (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
    const spacing = (mid.x - left.x + (right.x - mid.x)) / 2;

    return {
      detected: true,
      status: 'success',
      holes: refined,
      center: { x: mid.x, y: mid.y },
      angle: Math.round(angle * 10000) / 10000,
      spacing: Math.round(spacing * 1000) / 1000,
      edge: band.edge,
      message: `${band.edge === 'top' ? '上端' : '下端'}で 3 つの穴を検出 (間隔 ${Math.round(spacing)}px / 傾き ${angle.toFixed(2)}°)`,
    };
    }
  }
  }

  // ⚠️ 「見つかりません」で終わらせないこと。どこまで行って何で落ちたかを返す
  return failed(
    `タップ穴が見つかりませんでした。もっとも近かったのは ${bestNote || '(走査できませんでした)'}` +
      `\n試した順: ${tries.join(' / ')}`
  );
}

/** 検出結果を、そのまま合わせ先として使う */
export function referenceFromDetection(
  detection: PegDetection,
  size?: { width: number; height: number }
): PegReference {
  return {
    center: { ...detection.center },
    angle: detection.angle,
    spacing: detection.spacing,
    width: size?.width,
    height: size?.height,
  };
}

/**
 * 検出結果を基準へ重ねるための補正量。
 *
 * ⚠️ 表示側は「画像の中心を軸に回してから平行移動」する順で描く。
 * 平行移動の量は、回したあとの穴の位置から求めること。先に引き算すると、
 * 傾きがあるときに合わない。
 */
export function pegTransformTo(detection: PegDetection, reference: PegReference): PegTransform {
  if (!detection.detected) return { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 };

  /**
   * 真ん中の穴を基準の位置へ動かすだけ。
   * ⚠️ 回転も拡大縮小もしないこと (本家と同じ)。傾きと間隔は測ってあるが、
   * それは「この検出を信じてよいか」を見るために使う (pegGeometryDiff)。
   */
  return {
    offsetX: Math.round((reference.center.x - detection.center.x) * 100) / 100,
    offsetY: Math.round((reference.center.y - detection.center.y) * 100) / 100,
    rotation: 0,
    scale: 1,
  };
}

/**
 * 検出した穴の並びが、基準とどれだけ食い違っているか。
 *
 * ⚠️ 平行移動しかしない以上、傾きや間隔のずれは補正できない。だからこそ
 * 「大きく食い違う = 穴を取り違えている」の判断材料として使うこと。
 */
export function pegGeometryDiff(
  detection: PegDetection,
  reference: PegReference
): { angleDiff: number; spacingRatio: number } {
  return {
    angleDiff: Math.round((detection.angle - reference.angle) * 10000) / 10000,
    spacingRatio:
      detection.spacing > 0 ? Math.round((detection.spacing / reference.spacing) * 100000) / 100000 : 1,
  };
}

/**
 * 補正を画素へ焼き込む。
 *
 * ⚠️ 補間しないこと (最近傍で運ぶ)。彩色データは「色そのもの」で塗り分けを持つので、
 * 中間色ができると別の色として扱われ、バケツ塗りや色置換が効かなくなる。
 * ⚠️ はみ出したところは純白 (= 透明) で埋める。encodeTGA が alpha 0 を純白として
 * 書き戻す規約に合わせる。
 * ⚠️ 表示と同じ順で動かすこと (画像の中心を軸に回してから平行移動)。
 * ここがずれると、画面で合わせたものが焼き込むとずれる。
 */
/**
 * その補正で実際に画が動くか。
 *
 * ⚠️ 1px 未満のずれで書き直さないこと。焼き込みは丸めて行を動かすので
 * 0px 移動になり、JPEG を作り直しただけで終わる (画質が落ちて控えも増える)。
 * 2026-09-02 の実データでは 37 枚すべてが 0.0〜0.9px で、全部が無駄な書き直しだった。
 */
export function pegTransformMoves(transform: PegTransform): boolean {
  return Math.round(transform.offsetX) !== 0 || Math.round(transform.offsetY) !== 0;
}

export function bakePegTransform(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  transform: PegTransform,
  /**
   * 出したい画寸。省略すると元と同じ。
   * ⚠️ ここを揃えると、コマ送りしても絵が飛ばなくなる。
   * はみ出した分は切り、足りない縁は白 (透明) で埋める。
   */
  outSize?: { width: number; height: number }
): Uint8ClampedArray {
  const outWidth = outSize?.width ?? width;
  const outHeight = outSize?.height ?? height;

  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  // 透明 = 純白。RGB も 255 にしておく
  out.fill(255);
  for (let i = 3; i < out.length; i += 4) out[i] = 0;

  /**
   * ⚠️ 行をそのままずらすだけにすること (本家と同じ)。
   * 回転や拡大縮小を入れると画素を作り直すことになり、
   * 線が甘くなるうえ、純白 = 透明の縁が中間色になる。
   */
  const dx = Math.round(transform.offsetX);
  const dy = Math.round(transform.offsetY);

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;

      const from = (sy * width + sx) * 4;
      const to = (y * outWidth + x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }

  return out;
}
