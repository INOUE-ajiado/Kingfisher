/**
 * オニオンスキン (前後のコマを薄く重ねる) の色づけ。
 *
 * ⚠️ 過去と未来で処理を分けて書かないこと。以前は色と符号だけが違う
 * 46 行が 2 つ並んでおり、片方だけ直る形になっていた。
 * ⚠️ 描くたびに作り直さないこと。ブラシを 1 回引くだけで描き直しが走るので、
 * 重ねるコマの数だけ canvas の生成と全画素の走査が毎回起きていた。
 * 同じコマ・同じ色・同じ出し方なら、前に作った絵をそのまま使う。
 */

export type OnionDisplayMode = 'monochrome' | 'half-color' | 'original';

export interface OnionColor {
  r: number;
  g: number;
  b: number;
}

export interface OnionFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * 1 コマぶんを色づけする。透明な画素はそのまま透明にする。
 *
 * - monochrome  … 明るさだけを残して指定色に染める
 * - half-color  … 元の色と指定色の中間
 * - original    … 元の色のまま
 */
export function tintOnionPixels(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  color: OnionColor,
  mode: OnionDisplayMode
): void {
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a === 0) continue;

    if (mode === 'monochrome') {
      const lum = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255;
      dst[i] = Math.round(lum * color.r);
      dst[i + 1] = Math.round(lum * color.g);
      dst[i + 2] = Math.round(lum * color.b);
    } else if (mode === 'half-color') {
      dst[i] = Math.round((src[i] + color.r) / 2);
      dst[i + 1] = Math.round((src[i + 1] + color.g) / 2);
      dst[i + 2] = Math.round((src[i + 2] + color.b) / 2);
    } else {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
    }
    dst[i + 3] = a;
  }
}

/** 重ねるコマの濃さ。奥へ行くほど薄く、薄くなりすぎない下限を置く */
export function onionAlpha(startOpacityPercent: number, opacityStepPercent: number, step: number): number {
  const start = startOpacityPercent / 100;
  const decay = (opacityStepPercent * (step - 1)) / 100;
  return Math.max(0.05, start - decay);
}

// ── 色づけした絵の使い回し ──────────────────────────────

/** コマごとに変わらない番号を振る (中身ではなく「どのコマか」で見分ける) */
const frameIds = new WeakMap<object, number>();
let nextFrameId = 1;

function frameIdOf(frame: object): number {
  let id = frameIds.get(frame);
  if (id === undefined) {
    id = nextFrameId++;
    frameIds.set(frame, id);
  }
  return id;
}

/** 使い回しの上限。カット全体を重ねる指定でも足りる枚数 */
const CACHE_LIMIT = 48;

const cache = new Map<string, HTMLCanvasElement>();

/** テストと素材の切り替えのために中身を捨てる */
export function clearOnionCache(): void {
  cache.clear();
}

export function onionCacheSize(): number {
  return cache.size;
}

/**
 * 色づけしたコマを返す。同じ条件で 2 度目以降は作り直さない。
 *
 * ⚠️ 色と出し方も鍵に含めること。含めないと、ライトテーブルの色を変えても
 * 前の色のまま表示され続ける。
 */
export function tintedOnionCanvas(
  frame: OnionFrame,
  color: OnionColor,
  mode: OnionDisplayMode,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')
): HTMLCanvasElement | null {
  const key = `${frameIdOf(frame)}|${mode}|${color.r},${color.g},${color.b}`;

  const hit = cache.get(key);
  if (hit) {
    // 使ったものを後ろへ回す (古いものから捨てるため)
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const canvas = createCanvas();
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(frame.width, frame.height);
  tintOnionPixels(frame.data, imageData.data, color, mode);
  ctx.putImageData(imageData, 0, 0);

  cache.set(key, canvas);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return canvas;
}
