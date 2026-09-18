/**
 * 表示の回転 (回転ビュー) まわりの座標計算。
 *
 * セルの表示は CSS の transform で `translate → scale → rotate` の順に掛けている。
 * 画面上の点から画像の画素へ戻すには、この逆をたどる必要がある。
 *
 * ⚠️ 回転していると getBoundingClientRect は「回した後の外接四角形」を返す。
 * rect.width をそのまま表示倍率に使えないので、外接四角形の幅から倍率を割り出すこと。
 */

/** 回した後の外接四角形から、画面上の表示倍率を割り出す */
export function scaleFromBoundingRect(
  rect: { width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  rotationDeg: number,
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return 1;
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const boxW = imageWidth * c + imageHeight * s;
  const boxH = imageWidth * s + imageHeight * c;
  if (boxW > 0 && rect.width > 0) return rect.width / boxW;
  if (boxH > 0 && rect.height > 0) return rect.height / boxH;
  return 1;
}

/**
 * 画面上の座標 (clientX / clientY) を画像の画素座標へ直す。
 * rect は canvas の getBoundingClientRect。
 */
export function screenToImagePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  rotationDeg = 0,
): { x: number; y: number } {
  const scale = scaleFromBoundingRect(rect, imageWidth, imageHeight, rotationDeg);
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  // 画面 → 画像は回転の逆回し。画面は y が下向きなので、回転行列は [c -s; s c]
  const ix = (dx * c + dy * s) / scale;
  const iy = (-dx * s + dy * c) / scale;
  return {
    x: Math.floor(ix + imageWidth / 2),
    y: Math.floor(iy + imageHeight / 2),
  };
}

/** 中心から見た点の角度 (度)。回転ビューのドラッグ量を出すのに使う */
export function angleFromCenter(clientX: number, clientY: number, center: { x: number; y: number }): number {
  return (Math.atan2(clientY - center.y, clientX - center.x) * 180) / Math.PI;
}

/** 角度を -180〜180 に畳む */
export function normalizeAngle(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(a, -180)) a = 180;
  return a;
}

/** step 度きざみに寄せる (Shift を押している間のスナップ) */
export function snapAngle(deg: number, step = 15): number {
  if (step <= 0) return normalizeAngle(deg);
  return normalizeAngle(Math.round(deg / step) * step);
}
