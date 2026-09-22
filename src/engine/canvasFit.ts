/**
 * 表示を画面へ合わせる (自動フィット) ときの計算。
 *
 * ⚠️ 角度を落とさないこと。回転ビューで傾けた向きは自動フィットの対象外で、
 * ここで落とすとコマを送るたびに向きが戻ってしまう。
 * ⚠️ 面ごとに計算すること。Win A の画像の高さで Win B まで合わせると、
 * サイズの違うリテイク素材を並べたときに合わない。
 */

import { CanvasTransform } from '../store/types';

/** 上下に空ける余白 (px)。上下 24px ずつ */
export const FIT_MARGIN_PX = 48;

/** 自動フィットで許す倍率の範囲 */
export const FIT_MIN_SCALE = 0.2;
export const FIT_MAX_SCALE = 3.0;

/**
 * 表示領域の高さに画像を収める変換を返す。
 * 収められない (領域も画像も高さが無い) ときは null。
 */
export function fitTransformFor(
  containerHeight: number,
  imageHeight: number,
  current: CanvasTransform
): CanvasTransform | null {
  const availableHeight = containerHeight - FIT_MARGIN_PX;
  if (!(availableHeight > 0) || !(imageHeight > 0)) return null;

  const scale = Math.min(Math.max(FIT_MIN_SCALE, availableHeight / imageHeight), FIT_MAX_SCALE);
  // ⚠️ 角度はそのまま持ち越す (自動フィットは倍率と位置だけを決める)
  return { scale, offsetX: 0, offsetY: 0, rotation: current.rotation ?? 0 };
}

/**
 * 今の表示が「自分で動かしたもの」か。
 *
 * 最後に自動で合わせた値と食い違っていれば、その面は本人が触っている。
 * ⚠️ 面ごとに見ること。Win A の値だけで判断すると、Win B だけを動かした人の
 * 操作が守られない。
 * ⚠️ 角度は見ないこと。自動フィットは角度を変えないので、回しただけの面まで
 * 「触った」と見なすと、その面が二度と自動で合わなくなる。
 */
export function isUserAdjusted(
  fitted: CanvasTransform | null,
  current: CanvasTransform
): boolean {
  if (!fitted) return false;
  return (
    fitted.scale !== current.scale ||
    fitted.offsetX !== current.offsetX ||
    fitted.offsetY !== current.offsetY
  );
}

/** 画像の大きさを「640x480」の形で表す (同じ大きさの間は合わせ直さないための鍵) */
export function sizeKeyOf(image: { width: number; height: number } | null): string | null {
  return image ? `${image.width}x${image.height}` : null;
}
