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
      const coreURL = await toBlobURL(`${localBaseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${localBaseURL}/ffmpeg-core.wasm`, 'application/wasm');
      
      logDebug('roll', '[FFmpeg WASM] コアスクリプト・WASMバイナリのBlob変換完了。モジュールを初期化中...');
      await ffmpeg.load({ coreURL, wasmURL });
      ffmpegInstance = ffmpeg;
      logDebug('roll', '[FFmpeg WASM] デコーダ (Same-Origin) の初期化・読み込みに成功しました');
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
  const outName = `out_${Date.now()}.mp4`;

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

    // 高速トランスコード: 標準 WASM ビルドに必ず含まれる mpeg4 エンコーダを優先
    try {
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
    } catch (mpeg4Err: any) {
      logDebug('roll', `mpeg4 変換失敗 (${mpeg4Err?.message || mpeg4Err})。libx264 フォールバック試行...`, undefined, 'warn');
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
    }

    logDebug('roll', `変換出力ファイルを読み込み中 (${outName})...`);
    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    const outSizeMB = (data.byteLength / (1024 * 1024)).toFixed(2);
    logDebug('roll', `変換出力ファイルの取得成功 (生成サイズ: ${outSizeMB} MB)`);

    const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
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
