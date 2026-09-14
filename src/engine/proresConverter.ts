/**
 * Apple ProRes (apch / apcn / apcs 等) などのブラウザ非対応映像を
 * ブラウザ内 (WebAssembly / FFmpeg) で H.264 MP4 へ自動変換するモジュール。
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { logDebug } from './debugLog';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

/**
 * FFmpeg WASM インスタンスの初期化
 */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const localBaseURL = `${origin}/ffmpeg`;
    const cdnBaseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${localBaseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${localBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpegInstance = ffmpeg;
      logDebug('roll', 'FFmpeg WASM デコーダ (Same-Origin) の読み込みに成功しました');
      return ffmpeg;
    } catch (localErr) {
      console.warn('Local ffmpeg core load failed, trying CDN fallback:', localErr);
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${cdnBaseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${cdnBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpegInstance = ffmpeg;
        logDebug('roll', 'FFmpeg WASM デコーダ (CDN) の読み込みに成功しました');
        return ffmpeg;
      } catch (err) {
        loadPromise = null;
        console.error('FFmpeg WASM load error:', err);
        throw err;
      }
    }
  })();

  return loadPromise;
}

/** 変換済みファイルのキャッシュ (同じファイルの再選択時は即時利用) */
const conversionCache = new Map<string, { blob: Blob; objectUrl: string }>();

/**
 * ProRes 映像ファイルをブラウザ再生可能な H.264 MP4 へ自動変換する
 */
export async function convertProResToMp4(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ blob: Blob; objectUrl: string }> {
  const cacheKey = `${file.name}_${file.size}_${file.lastModified}`;
  if (conversionCache.has(cacheKey)) {
    logDebug('roll', `変換済みキャッシュを利用: ${file.name}`);
    return conversionCache.get(cacheKey)!;
  }

  const ffmpeg = await getFFmpeg();

  const sanitizeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const inName = `in_${Date.now()}_${sanitizeName}`;
  const outName = `out_${Date.now()}.mp4`;

  let progressListener: ((e: { progress: number; time: number }) => void) | null = null;
  if (onProgress) {
    progressListener = ({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      onProgress(pct);
    };
    ffmpeg.on('progress', progressListener);
  }

  try {
    logDebug('roll', `ProRes 自動変換処理を開始: ${file.name}`);
    await ffmpeg.writeFile(inName, await fetchFile(file));

    // 高速トランスコード (-preset ultrafast -crf 22 -pix_fmt yuv420p)
    await ffmpeg.exec([
      '-i',
      inName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      'faststart',
      outName,
    ]);

    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
    const objectUrl = URL.createObjectURL(blob);

    // 一時ファイル解放
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});

    const result = { blob, objectUrl };
    conversionCache.set(cacheKey, result);
    logDebug('roll', `ProRes 自動変換完了: ${file.name}`);
    return result;
  } catch (err) {
    console.error('ProRes video conversion failed:', err);
    throw err;
  } finally {
    if (progressListener) {
      ffmpeg.off('progress', progressListener);
    }
  }
}
