/**
 * 配信中に共有するマウスポインターの位置の計算。
 *
 * ⚠️ 画面 (枠) ではなく「映像が実際に映っている四角」を基準に 0〜1 で表すこと。
 * 枠を基準にすると、窓の大きさや縦横比が人によって違うため、
 * オペレーターが指した場所と視聴者に見える場所がずれる。
 *
 * DOM に触れない純粋な関数だけを置く (テストから直接呼べるように)。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointerPosition {
  /** 映像の左端からの割合 (0〜1) */
  x: number;
  /** 映像の上端からの割合 (0〜1) */
  y: number;
}

/**
 * object-contain で表示している映像が、枠の中のどこに映っているか。
 * 余白 (レターボックス) を除いた四角を返す。
 */
export function videoContentRect(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number
): Rect {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  if (!(videoWidth > 0) || !(videoHeight > 0)) {
    // 映像の大きさが分からないうちは枠いっぱいとみなす
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }
  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height };
}

/** 枠の中の座標 → 映像内の割合。映像の外なら null (ポインターを出さない) */
export function toVideoPosition(offsetX: number, offsetY: number, content: Rect): PointerPosition | null {
  if (!(content.width > 0) || !(content.height > 0)) return null;
  const x = (offsetX - content.x) / content.width;
  const y = (offsetY - content.y) / content.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** 映像内の割合 → 枠の中の座標 (視聴者の画面で描く位置) */
export function fromVideoPosition(position: PointerPosition, content: Rect): { left: number; top: number } {
  return {
    left: content.x + position.x * content.width,
    top: content.y + position.y * content.height,
  };
}

/** 位置を送る間隔 (ms)。滑らかさと通信量の折り合い */
export const POINTER_SEND_INTERVAL_MS = 33;

/**
 * 受け取った位置へ追いつく速さ (ms)。小さいほどキビキビ、大きいほどなめらか。
 *
 * ⚠️ 届いた位置をそのまま描かないこと。届くのは 1 秒に数十回なので、
 * そのまま置くと飛び飛びに見える (カクつく)。毎フレーム少しずつ近づける。
 * ⚠️ 大きくしすぎないこと。相手の動きから遅れて付いていく感じになる。
 * 遅れの埋め合わせは predictPointer (下) が受け持つ。
 */
export const POINTER_FOLLOW_MS = 28;

// ─── 遅れの埋め合わせ (予測) ─────────────────────────────────────────────────

/**
 * 予測してよい上限 (ms)。
 * 通信の片道が 100〜150ms になることがあるので、そこを覆える長さにする。
 * ⚠️ 無制限にしないこと。相手が急に止まったとき、伸ばし続けて行き過ぎる。
 */
export const MAX_POINTER_PREDICT_MS = 320;

/** 間がこれだけ空いたら、動きが途切れたとみなして予測しない */
export const POINTER_SAMPLE_GAP_MS = 250;

export interface PointerSample {
  position: PointerPosition;
  /** 送り手が書いた時刻 (サーバー基準) */
  at: number;
}

/**
 * 届いた 2 点の速さから「今いるはずの位置」を出す。
 *
 * 通信には片道 100ms 前後かかる。届いた位置をそのまま描くと、その分だけ
 * オペレーターの手より後ろに出続ける。速さが分かれば先を読んで埋められる。
 *
 * ⚠️ 予測は上限で頭打ちにすること。相手が急に止まったとき、伸ばし続けると
 * 行き過ぎて戻る動き (ゴムのような揺り返し) になる。
 */
export function predictPointer(previous: PointerSample | null, latest: PointerSample, now: number): PointerPosition {
  const ahead = Math.min(Math.max(now - latest.at, 0), MAX_POINTER_PREDICT_MS);
  if (!previous) return latest.position;

  const span = latest.at - previous.at;
  if (!(span > 0) || span > POINTER_SAMPLE_GAP_MS) return latest.position;

  const vx = (latest.position.x - previous.position.x) / span;
  const vy = (latest.position.y - previous.position.y) / span;
  return {
    x: Math.min(Math.max(latest.position.x + vx * ahead, 0), 1),
    y: Math.min(Math.max(latest.position.y + vy * ahead, 0), 1),
  };
}

/**
 * 今いる位置から目標へ、経過時間ぶんだけ近づけた位置。
 * フレームの間隔が変わっても速さが揃うよう、指数で近づける。
 */
export function smoothTowards(
  current: PointerPosition,
  target: PointerPosition,
  deltaMs: number,
  responseMs: number = POINTER_FOLLOW_MS
): PointerPosition {
  if (!(responseMs > 0) || !(deltaMs > 0)) return target;
  const t = 1 - Math.exp(-deltaMs / responseMs);
  const next = {
    x: current.x + (target.x - current.x) * t,
    y: current.y + (target.y - current.y) * t,
  };
  // ほぼ着いたら目標に合わせる (いつまでも極小の差を追わない)
  if (Math.abs(target.x - next.x) < 0.0005 && Math.abs(target.y - next.y) < 0.0005) return target;
  return next;
}

/** この時間だけ更新が無ければ、送り手が離れたとみなして消す */
export const POINTER_STALE_MS = 5000;

export function isPointerFresh(updatedAt: number, now: number): boolean {
  return now - updatedAt < POINTER_STALE_MS;
}

// ─── ポインターの見た目 ───────────────────────────────────────────────────────

/**
 * 既定の色。オペレーターごとに変わるよう、メールアドレスから選ぶ。
 * ⚠️ 映像の上で見分けられる色にすること。暗い色や肌色に近い色は避ける。
 */
export const POINTER_COLORS: { label: string; value: string }[] = [
  { label: '赤', value: '#ff2d2d' },
  { label: '黄', value: '#ffd400' },
  { label: '水色', value: '#21d4fd' },
  { label: '緑', value: '#3ddc84' },
  { label: '桃', value: '#ff5cf4' },
  { label: '橙', value: '#ff8a1f' },
  { label: '白', value: '#ffffff' },
];

export const MIN_POINTER_SIZE = 10;
export const MAX_POINTER_SIZE = 48;
export const DEFAULT_POINTER_SIZE = 18;

export function clampPointerSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_POINTER_SIZE;
  return Math.round(Math.min(Math.max(size, MIN_POINTER_SIZE), MAX_POINTER_SIZE));
}

/** #rrggbb 以外は受け付けない (規則でも同じ形を求める) */
export function isPointerColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

/** 人ごとに既定の色を割り当てる。同じ人はいつも同じ色になる */
export function defaultPointerColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return POINTER_COLORS[hash % POINTER_COLORS.length].value;
}

/** #rrggbb → rgba(r, g, b, a) */
export function withAlpha(color: string, alpha: number): string {
  const safe = isPointerColor(color) ? color : POINTER_COLORS[0].value;
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── ぼかしと描画 ────────────────────────────────────────────────────────────

/** ポインターのぼやけ具合 (0 = くっきり、1 = ふんわり) */
export const DEFAULT_POINTER_BLUR = 0.5;

export function clampPointerBlur(blur: number): number {
  if (!Number.isFinite(blur)) return DEFAULT_POINTER_BLUR;
  return Math.min(Math.max(Math.round(blur * 100) / 100, 0), 1);
}

/**
 * ぼやけ具合から、丸の描き方を決める。
 * 0 なら縁のはっきりした点、1 なら周りが大きくにじむ点になる。
 */
export function pointerGlow(size: number, blur: number): { core: number; spread: number; blurPx: number } {
  const b = clampPointerBlur(blur);
  return {
    // 芯の割合 (ぼかすほど芯は小さく)
    core: Math.round((1 - b) * 70 + 20),
    spread: Math.round(size * (0.2 + b * 0.9)),
    blurPx: Math.round(size * (0.3 + b * 1.6)),
  };
}

/** 描いた線の太さ。窓の大きさが違っても、映像に対する太さが同じになるようにする */
export const STROKE_REFERENCE_WIDTH = 1280;
export const MIN_STROKE_SIZE = 2;
export const MAX_STROKE_SIZE = 24;
export const DEFAULT_STROKE_SIZE = 6;

export function clampStrokeSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_STROKE_SIZE;
  return Math.round(Math.min(Math.max(size, MIN_STROKE_SIZE), MAX_STROKE_SIZE));
}

export function strokeWidthPx(size: number, contentWidth: number): number {
  if (!(contentWidth > 0)) return clampStrokeSize(size);
  return Math.max(1, (clampStrokeSize(size) * contentWidth) / STROKE_REFERENCE_WIDTH);
}

/**
 * 描いた線が残る時間と、消えかけの時間。
 * ⚠️ 指示を出したそばから画面が汚れないよう短くしてある (2026-09-22 に 10 秒 → 3 秒)。
 */
export const STROKE_LIFETIME_MS = 3000;
export const STROKE_FADE_MS = 1000;

/** 経過に応じた濃さ。寿命を過ぎたら 0 (描かない) */
export function strokeOpacity(updatedAt: number, now: number): number {
  const age = now - updatedAt;
  if (age >= STROKE_LIFETIME_MS) return 0;
  const fadeStart = STROKE_LIFETIME_MS - STROKE_FADE_MS;
  if (age <= fadeStart) return 1;
  return Math.max(0, 1 - (age - fadeStart) / STROKE_FADE_MS);
}

/** 1 本の線に入れる点の上限。超えたら線を分ける (1 回の送信を小さく保つ) */
export const MAX_STROKE_POINTS = 120;

/** 点の並び ⇄ 文字列 ("x,y|x,y|…")。小数は 4 桁に丸める */
export function encodeStrokePoints(points: PointerPosition[]): string {
  return points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join('|');
}

export function decodeStrokePoints(encoded: string): PointerPosition[] {
  if (!encoded) return [];
  const points: PointerPosition[] = [];
  for (const pair of encoded.split('|')) {
    const [x, y] = pair.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return points;
}
