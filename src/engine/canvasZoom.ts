/**
 * ホイール操作 (拡大縮小 / 2 本指のパン) の計算。
 *
 * ⚠️ 面ごとに書き写さないこと。以前はセルの面と参照画像の面に同じ式が
 * まるごとコピーされており、片方だけ直すと操作感が食い違っていた。
 * ⚠️ 倍率は必ず「今の値」を渡すこと。ホイールは 1 フレームに何度も来るので、
 * 描画時に閉じ込めた値から計算すると、何回転させても 1 段しか変わらない
 * (2026-08-31 の報告)。
 */

import { CanvasTransform } from '../store/types';

/** 拡大縮小の範囲 */
export const ZOOM_MIN_SCALE = 0.2;
export const ZOOM_MAX_SCALE = 5.0;

/** マウスホイール 1 回転ぶんの倍率 */
const WHEEL_ZOOM_STEP = 1.1;

/** トラックパッドのピンチの効き (deltaY 1 あたり) */
const PINCH_ZOOM_BASE = 0.993;

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  /** カーソルの位置 (要素の左上からの px) */
  x: number;
  y: number;
  /** 要素の大きさ (px) */
  width: number;
  height: number;
}

/**
 * ホイールの一撃から、次の表示位置を出す。
 *
 * トラックパッドで ctrl を押していなければ 2 本指のパン、
 * それ以外は拡大縮小 (カーソルの位置を中心に寄せる)。
 */
export function wheelTransform(
  current: CanvasTransform,
  input: WheelInput,
  inputMode: 'mouse' | 'trackpad'
): CanvasTransform {
  if (inputMode === 'trackpad' && !input.ctrlKey) {
    return {
      ...current,
      offsetX: current.offsetX - input.deltaX,
      offsetY: current.offsetY - input.deltaY,
    };
  }

  const factor =
    inputMode === 'trackpad' && input.ctrlKey
      ? Math.pow(PINCH_ZOOM_BASE, input.deltaY)
      : input.deltaY < 0
      ? WHEEL_ZOOM_STEP
      : 1 / WHEEL_ZOOM_STEP;

  const scale = Math.min(Math.max(ZOOM_MIN_SCALE, current.scale * factor), ZOOM_MAX_SCALE);

  // カーソルの下にある点が動かないように、中心からのずれを補正する
  const ratio = scale / current.scale;
  const cx = input.width / 2;
  const cy = input.height / 2;

  return {
    ...current,
    scale,
    offsetX: (input.x - cx) * (1 - ratio) + current.offsetX * ratio,
    offsetY: (input.y - cy) * (1 - ratio) + current.offsetY * ratio,
  };
}

/** React のホイール事象を、計算に渡す形へ直す */
export function wheelInputFrom(e: {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  clientX: number;
  clientY: number;
  currentTarget: Element;
}): WheelInput {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    deltaX: e.deltaX,
    deltaY: e.deltaY,
    ctrlKey: e.ctrlKey,
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}
