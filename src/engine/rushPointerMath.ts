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
export const POINTER_SEND_INTERVAL_MS = 60;

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
