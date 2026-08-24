import { useCallback, useEffect, useState } from 'react';
import { usePaintStore } from '../store/usePaintStore';
import { TGAImage } from '../engine/tga';
import { decodeAnyImageFile } from '../engine/imageDecode';
import { usePrefetchWorker } from './usePrefetchWorker';

export type LoadFrameFn = (index: number, view: 0 | 1) => Promise<TGAImage | null>;

/**
 * セル画像の読み込みを一手に引き受けるフック。
 *
 *  - ファイル名は resolveFileNameForView で解決する (A/B で名前が違う異名連番に対応)
 *  - 一度デコードした画像はストアのキャッシュに載せ、再デコードを避ける
 *  - 保存後の最新内容を確実に読むため、フォルダハンドル経由の読み出しを優先する
 *  - TGA のデコードは Web Worker へ逃がし、コマ送り時に UI を止めない
 *
 * 返す画像は「読み込んだままの原本」。編集対象に渡す側で複製すること。
 */
export function useFrameLoader(): LoadFrameFn {
  const {
    resolveFileNameForView,
    getImageCacheKey,
    getCachedImage,
    putCachedImage,
    folderHandleA,
    folderHandleB,
    fileListA,
    fileListB,
    fileMapA,
    fileMapB,
    unifiedFileList,
  } = usePaintStore();

  const { decodeTgaAsync } = usePrefetchWorker();

  return useCallback(
    async (index: number, view: 0 | 1): Promise<TGAImage | null> => {
      const fileName = resolveFileNameForView(index, view);
      if (!fileName) return null;

      const cacheKey = getImageCacheKey(view, fileName);
      const cached = getCachedImage(cacheKey);
      if (cached) return cached;

      const folderHandle = view === 1 ? folderHandleB : folderHandleA;
      const fileList = view === 1 ? fileListB : fileListA;
      const fileMap = view === 1 ? fileMapB : fileMapA;

      if (folderHandle && fileList.includes(fileName)) {
        try {
          const fileHandle = await folderHandle.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          const decoded = await decodeAnyImageFile(file, decodeTgaAsync);
          putCachedImage(cacheKey, decoded);
          return decoded;
        } catch (e) {
          console.error(`Failed to read ${fileName} from folder handle:`, e);
        }
      }

      if (fileMap.has(fileName)) {
        try {
          const decoded = await decodeAnyImageFile(fileMap.get(fileName)!, decodeTgaAsync);
          putCachedImage(cacheKey, decoded);
          return decoded;
        } catch (e) {
          console.error(`Failed to decode ${fileName} from dropped files:`, e);
        }
      }

      return null;
    },
    [
      resolveFileNameForView,
      getImageCacheKey,
      getCachedImage,
      putCachedImage,
      decodeTgaAsync,
      folderHandleA,
      folderHandleB,
      fileListA,
      fileListB,
      fileMapA,
      fileMapB,
      unifiedFileList,
    ]
  );
}

/**
 * 前後のセルを裏で先読みしてキャッシュに載せる。
 * これにより PageUp / PageDown のコマ送りが待ち時間なしで切り替わる。
 */
export function useCellPrefetch(loadFrame: LoadFrameFn) {
  const { currentFileIndex, splitFileIndex, isSplitView, unifiedFileList, isPlaying } =
    usePaintStore();

  useEffect(() => {
    if (unifiedFileList.length === 0) return;
    let cancelled = false;

    // 現在のセルの読み込みを優先させるため、少し遅らせてから裏で走らせる
    const timer = setTimeout(async () => {
      const offsets = isPlaying ? [1, 2, 3] : [1, -1, 2, -2];

      for (const offset of offsets) {
        if (cancelled) return;
        const idx = currentFileIndex + offset;
        if (idx < 0 || idx >= unifiedFileList.length) continue;
        await loadFrame(idx, 0);
      }

      if (!isSplitView) return;
      for (const offset of offsets) {
        if (cancelled) return;
        const idx = splitFileIndex + offset;
        if (idx < 0 || idx >= unifiedFileList.length) continue;
        await loadFrame(idx, 1);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentFileIndex, splitFileIndex, isSplitView, unifiedFileList, isPlaying, loadFrame]);
}

/**
 * オニオンスキン (ライトテーブル) 用に前後フレームをまとめて読み込む。
 * offset (-N〜+N, 0 を除く) をキーにしたマップを返す。
 */
export function useOnionSkinFrames(loadFrame: LoadFrameFn): Map<number, TGAImage> {
  const { currentFileIndex, unifiedFileList, lightTable, isPlaying } = usePaintStore();
  const [onionFramesMap, setOnionFramesMap] = useState<Map<number, TGAImage>>(new Map());

  const { enabled, pastFrames, futureFrames } = lightTable;

  useEffect(() => {
    if (!enabled || isPlaying) return;
    let isSubscribed = true;

    (async () => {
      const offsets: number[] = [];
      for (let offset = -1; offset >= -(pastFrames ?? 1); offset--) offsets.push(offset);
      for (let offset = 1; offset <= (futureFrames ?? 1); offset++) offsets.push(offset);

      // 逐次 await をやめて並列読み込み。既にキャッシュ済みのコマは即座に返る。
      const frames = await Promise.all(
        offsets.map((offset) => {
          const targetIndex = currentFileIndex + offset;
          if (targetIndex < 0 || targetIndex >= unifiedFileList.length) {
            return Promise.resolve(null);
          }
          return loadFrame(targetIndex, 0);
        })
      );

      if (!isSubscribed) return;

      const loadedMap = new Map<number, TGAImage>();
      offsets.forEach((offset, i) => {
        const frame = frames[i];
        if (frame) loadedMap.set(offset, frame);
      });
      setOnionFramesMap(loadedMap);
    })();

    return () => {
      isSubscribed = false;
    };
  }, [currentFileIndex, enabled, pastFrames, futureFrames, unifiedFileList, loadFrame, isPlaying]);

  return onionFramesMap;
}
