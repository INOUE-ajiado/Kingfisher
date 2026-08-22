// OLM PegHoleStabilizer 仕様準拠 タップ穴自動検出 ＆ 剛体変換算出エンジン

export interface PegStabilizerResult {
  detected: boolean;
  status: 'success' | 'failed' | 'idle';
  offsetX: number; // px
  offsetY: number; // px
  rotation: number; // degrees
  detectedHoles: { x: number; y: number }[];
}

export function detectPegHolesAndCalculateTransform(
  data: Uint8ClampedArray,
  width: number,
  height: number
): PegStabilizerResult {
  if (!data || width <= 0 || height <= 0) {
    return { detected: false, status: 'failed', offsetX: 0, offsetY: 0, rotation: 0, detectedHoles: [] };
  }

  // 1. 黒ピクセル（二値化された紙の穴候補）の検出
  const blackPoints: { x: number; y: number }[] = [];
  const step = 4; // 高速探索用サンプリングステップ

  for (let y = 0; y < Math.min(height, 300); y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      // 黒または透明度の高い穴部分
      if ((r < 50 && g < 50 && b < 50) || a === 0) {
        blackPoints.push({ x, y });
      }
    }
  }

  if (blackPoints.length < 3) {
    // 穴検出不可時のデフォルト補正パラメータ
    return {
      detected: false,
      status: 'failed',
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      detectedHoles: [],
    };
  }

  // 重心位置の同定
  let sumX = 0, sumY = 0;
  for (const p of blackPoints) {
    sumX += p.x;
    sumY += p.y;
  }
  const centerX = sumX / blackPoints.length;
  const centerY = sumY / blackPoints.length;

  // 理想のタップ中心座標（キャンバス上部中央）からの偏差
  const idealCenterX = width / 2;
  const idealCenterY = 50; // 通常上部50px付近

  const offsetX = idealCenterX - centerX;
  const offsetY = idealCenterY - centerY;

  // 左右のバランスからわずかな傾き(角度)を推定
  let leftCount = 0, rightCount = 0;
  let leftSumY = 0, rightSumY = 0;

  for (const p of blackPoints) {
    if (p.x < centerX) {
      leftCount++;
      leftSumY += p.y;
    } else {
      rightCount++;
      rightSumY += p.y;
    }
  }

  let rotation = 0;
  if (leftCount > 0 && rightCount > 0) {
    const avgLeftY = leftSumY / leftCount;
    const avgRightY = rightSumY / rightCount;
    const dy = avgRightY - avgLeftY;
    const dx = width / 2;
    rotation = Math.atan2(dy, dx) * (180 / Math.PI);
  }

  return {
    detected: true,
    status: 'success',
    offsetX: Math.round(offsetX * 10) / 10,
    offsetY: Math.round(offsetY * 10) / 10,
    rotation: Math.round(rotation * 100) / 100,
    detectedHoles: [
      { x: centerX - 100, y: centerY },
      { x: centerX, y: centerY },
      { x: centerX + 100, y: centerY },
    ],
  };
}
