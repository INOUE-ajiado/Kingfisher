import { useEffect, useRef, useCallback } from 'react';
import { decodeTGA, TGAImage } from '../engine/tga';
import { PrefetchRequest, PrefetchResponse } from '../workers/prefetchWorker';

type Pending = {
  resolve: (image: TGAImage) => void;
  reject: (err: Error) => void;
};

/**
 * TGA のデコードを Web Worker へ逃がすためのフック。
 *
 * 4K セルのデコードはメインスレッドで数十 ms かかるため、コマ送りのたびに
 * UI が固まる。デコードだけをワーカーに任せることで操作の引っかかりを無くす。
 *
 * ワーカーを生成できない環境ではメインスレッドで同期デコードにフォールバックするので、
 * 呼び出し側は成否を気にしなくてよい。
 */
export function usePrefetchWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, Pending>>(new Map());
  const nextIdRef = useRef(0);

  useEffect(() => {
    let worker: Worker | null = null;

    try {
      worker = new Worker(new URL('../workers/prefetchWorker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (e: MessageEvent<PrefetchResponse>) => {
        const { id, success, width, height, pixelDepth, data, error } = e.data;
        const pending = pendingRef.current.get(id);
        if (!pending) return;
        pendingRef.current.delete(id);

        if (success && data && width !== undefined && height !== undefined) {
          pending.resolve({ width, height, pixelDepth: pixelDepth ?? 32, data });
        } else {
          pending.reject(new Error(error || 'TGA decode failed in worker'));
        }
      };

      worker.onerror = (e) => {
        console.error('Prefetch worker error:', e.message);
        pendingRef.current.forEach((p) => p.reject(new Error(e.message)));
        pendingRef.current.clear();
      };
    } catch (e) {
      console.warn('Prefetch worker unavailable, falling back to main thread decode:', e);
      worker = null;
    }

    workerRef.current = worker;
    const pending = pendingRef.current;

    return () => {
      worker?.terminate();
      workerRef.current = null;
      pending.clear();
    };
  }, []);

  /** ArrayBuffer を TGAImage へデコードする。可能ならワーカー上で行う。 */
  const decodeTgaAsync = useCallback((buffer: ArrayBuffer): Promise<TGAImage> => {
    const worker = workerRef.current;
    if (!worker) {
      // ワーカーが使えない環境ではメインスレッドで処理する
      return Promise.resolve(decodeTGA(buffer));
    }

    return new Promise<TGAImage>((resolve, reject) => {
      const id = ++nextIdRef.current;
      pendingRef.current.set(id, { resolve, reject });

      const request: PrefetchRequest = { id, buffer };
      // buffer の所有権をワーカーへ移す (呼び出し側はこの後 buffer を触らないこと)
      worker.postMessage(request, [buffer]);
    });
  }, []);

  return { decodeTgaAsync };
}
