/**
 * ProRes 映像の高速フレーム抽出演進・デコーダー。
 * 動画全体の再エンコード（トランスコード）を必要とせず、
 * リクエストされたタイムスタンプ / コマ番号の画像フレームを直ちにパースし
 * Canvas へダイレクト描画します。
 */

import { getFFmpeg } from './proresConverter';
import { fetchFile } from '@ffmpeg/util';
import { logDebug } from './debugLog';

interface FrameExtractResult {
  blob: Blob;
  objectUrl: string;
}

const frameCache = new Map<string, FrameExtractResult>();

/**
 * 指定された動画ファイルと時間(秒)から 1 コマの静止画フレームを高速抽出
 */
export async function extractProResFrame(
  file: File,
  timeInSeconds: number
): Promise<FrameExtractResult> {
  const cacheKey = `${file.name}_${file.size}_${timeInSeconds.toFixed(3)}`;
  if (frameCache.has(cacheKey)) {
    return frameCache.get(cacheKey)!;
  }

  const ffmpeg = await getFFmpeg();
  const sanitizeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const inName = `frame_in_${Date.now()}_${sanitizeName}`;
  const outName = `frame_out_${Date.now()}.jpg`;

  try {
    const fileData = await fetchFile(file);
    await ffmpeg.writeFile(inName, fileData);

    // シーク位置 (-ss) から 1 フレーム (-vframes 1) だけ抽出し JPEG 生成
    await ffmpeg.exec([
      '-ss',
      timeInSeconds.toString(),
      '-i',
      inName,
      '-vframes',
      '1',
      '-q:v',
      '2',
      outName,
    ]);

    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    const blob = new Blob([new Uint8Array(data)], { type: 'image/jpeg' });
    const objectUrl = URL.createObjectURL(blob);

    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});

    const result = { blob, objectUrl };
    frameCache.set(cacheKey, result);
    return result;
  } catch (err: any) {
    logDebug('roll', `フレーム直描画に失敗しました (${err?.message || err})`, undefined, 'warn');
    throw err;
  }
}
