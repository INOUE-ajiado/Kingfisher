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

    logDebug('roll', `[FFmpeg WASM] デコーダコアの読み込みを開始します (Same-Origin: ${localBaseURL})`);

    try {
      logDebug('roll', '[FFmpeg WASM] 直パスでの ESM モジュール読み込みを試行中...');
      await ffmpeg.load({
        coreURL: `${localBaseURL}/ffmpeg-core.js`,
        wasmURL: `${localBaseURL}/ffmpeg-core.wasm`,
      });
      ffmpegInstance = ffmpeg;
      logDebug('roll', '[FFmpeg WASM] デコーダ (Same-Origin Direct) の初期化・読み込みに成功しました');
      return ffmpeg;
    } catch (directErr: any) {
      logDebug('roll', `[FFmpeg WASM] 直パス読み込み失敗: ${directErr?.message || directErr}。Blob URL変換を試行...`, undefined, 'warn');
      try {
        const coreURL = await toBlobURL(`${localBaseURL}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${localBaseURL}/ffmpeg-core.wasm`, 'application/wasm');
        await ffmpeg.load({ coreURL, wasmURL });
        ffmpegInstance = ffmpeg;
        logDebug('roll', '[FFmpeg WASM] デコーダ (Same-Origin Blob) の初期化・読み込みに成功しました');
        return ffmpeg;
      } catch (localErr: any) {
        logDebug('roll', `[FFmpeg WASM] Same-Origin 読み込み失敗: ${localErr?.message || localErr}`, undefined, 'warn');
        logDebug('roll', `[FFmpeg WASM] CDN フォールバックを試行中 (${cdnBaseURL})...`);
        try {
          const coreURL = await toBlobURL(`${cdnBaseURL}/ffmpeg-core.js`, 'text/javascript');
          const wasmURL = await toBlobURL(`${cdnBaseURL}/ffmpeg-core.wasm`, 'application/wasm');
          await ffmpeg.load({ coreURL, wasmURL });
          ffmpegInstance = ffmpeg;
          logDebug('roll', '[FFmpeg WASM] デコーダ (CDN) の初期化・読み込みに成功しました');
          return ffmpeg;
        } catch (err: any) {
          loadPromise = null;
          logDebug('roll', `[FFmpeg WASM] 致命的エラー: デコーダの読み込みに失敗しました (${err?.message || err})`, undefined, 'warn');
          console.error('FFmpeg WASM load error:', err);
          throw err;
        }
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

  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
  logDebug('roll', `ProRes 自動変換の準備開始: ${file.name} (サイズ: ${fileSizeMB} MB / type: ${file.type || '未指定'})`);

  const ffmpeg = await getFFmpeg();

  const sanitizeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const inName = `in_${Date.now()}_${sanitizeName}`;
  let outName = `out_${Date.now()}.webm`;
  let mimeType = 'video/webm';

  let progressListener: ((e: { progress: number; time: number }) => void) | null = null;
  if (onProgress) {
    progressListener = ({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      onProgress(pct);
    };
    ffmpeg.on('progress', progressListener);
  }

  const logListener = ({ message }: { message: string }) => {
    if (message.includes('Error') || message.includes('error') || message.includes('Stream #') || message.includes('codec')) {
      logDebug('roll', `[FFmpeg Log] ${message}`);
    }
  };
  ffmpeg.on('log', logListener);

  try {
    logDebug('roll', `仮想ファイルシステムへ入力ファイルを書き込み中 (${inName})...`);
    const fileData = await fetchFile(file);
    await ffmpeg.writeFile(inName, fileData);
    logDebug('roll', `仮想ファイル書き込み完了。トランスコード実行中...`);

    // ブラウザ互換性の高い WebM (VP8/VP9) または MP4 へ変換
    let converted = false;

    // 試行1: VP8 (WebM) — modern ブラウザ (Chrome/Safari/Firefox/Edge) 100% 対応
    try {
      outName = `out_${Date.now()}.webm`;
      mimeType = 'video/webm';
      logDebug('roll', `[FFmpeg Command] ffmpeg -i ${inName} -c:v vp8 -b:v 2M ${outName}`);
      await ffmpeg.exec([
        '-i',
        inName,
        '-c:v',
        'vp8',
        '-b:v',
        '2M',
        '-an', // 音声ストリームが無い/エラー予防
        outName,
      ]);
      converted = true;
    } catch (vp8Err: any) {
      logDebug('roll', `VP8 (WebM) 変換失敗 (${vp8Err?.message || vp8Err})。VP9 試行...`, undefined, 'warn');
    }

    // 試行2: VP9 (WebM)
    if (!converted) {
      try {
        outName = `out_${Date.now()}.webm`;
        mimeType = 'video/webm';
        logDebug('roll', `[FFmpeg Command] ffmpeg -i ${inName} -c:v vp9 -b:v 2M ${outName}`);
        await ffmpeg.exec([
          '-i',
          inName,
          '-c:v',
          'vp9',
          '-b:v',
          '2M',
          '-an',
          outName,
        ]);
        converted = true;
      } catch (vp9Err: any) {
        logDebug('roll', `VP9 (WebM) 変換失敗 (${vp9Err?.message || vp9Err})。libx264/mpeg4 試行...`, undefined, 'warn');
      }
    }

    // 試行3: libx264 (MP4)
    if (!converted) {
      try {
        outName = `out_${Date.now()}.mp4`;
        mimeType = 'video/mp4';
        logDebug('roll', `[FFmpeg Command] ffmpeg -i ${inName} -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -movflags faststart ${outName}`);
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
        converted = true;
      } catch (h264Err: any) {
        logDebug('roll', `libx264 変換失敗 (${h264Err?.message || h264Err})。mpeg4 試行...`, undefined, 'warn');
      }
    }

    // 試行4: mpeg4 (MP4) フォールバック
    if (!converted) {
      outName = `out_${Date.now()}.mp4`;
      mimeType = 'video/mp4';
      logDebug('roll', `[FFmpeg Command] ffmpeg -i ${inName} -c:v mpeg4 -q:v 2 -movflags faststart ${outName}`);
      await ffmpeg.exec([
        '-i',
        inName,
        '-c:v',
        'mpeg4',
        '-q:v',
        '2',
        '-movflags',
        'faststart',
        outName,
      ]);
    }

    logDebug('roll', `変換出力ファイルを読み込み中 (${outName})...`);
    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    const outSizeMB = (data.byteLength / (1024 * 1024)).toFixed(2);
    logDebug('roll', `変換出力ファイルの取得成功 (生成サイズ: ${outSizeMB} MB, mime: ${mimeType})`);

    const blob = new Blob([new Uint8Array(data)], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);

    // 一時ファイル解放
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});

    const result = { blob, objectUrl };
    conversionCache.set(cacheKey, result);
    logDebug('roll', `ProRes 自動変換が正常に完了しました: ${file.name}`);
    return result;
  } catch (err: any) {
    logDebug('roll', `ProRes 自動変換中にエラーが発生しました: ${err?.message || err}`, undefined, 'warn');
    console.error('ProRes video conversion failed:', err);
    throw err;
  } finally {
    if (progressListener) {
      ffmpeg.off('progress', progressListener);
    }
    ffmpeg.off('log', logListener);
  }
}
