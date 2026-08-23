import { useState, useEffect, useRef, useCallback } from 'react';
import { TGAImage } from '../engine/tga';
import { VectorExportOptions } from '../engine/vectorTrace';
import { WorkerTraceInput, WorkerTraceOutput } from '../workers/vectorTrace.worker';

export function useVectorTraceWorker() {
  const [svgString, setSvgString] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  useEffect(() => {
    // Vite 準拠の Web Worker インスタンスの生成
    const worker = new Worker(new URL('../workers/vectorTrace.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerTraceOutput>) => {
      const { requestId, svgString, error } = e.data;

      // リクエストIDが最新の場合のみ採用 (古い遅延計算結果はキャンセル/無視)
      if (requestId === activeRequestIdRef.current) {
        if (!error) {
          setSvgString(svgString);
        } else {
          console.error('Vector Worker error:', error);
        }
        setIsProcessing(false);
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const requestTrace = useCallback((image: TGAImage | null, options: VectorExportOptions) => {
    if (!image || !workerRef.current) {
      setSvgString('');
      setIsProcessing(false);
      return;
    }

    setIsProcessing(true);
    const requestId = ++activeRequestIdRef.current;

    // RGBA データの ArrayBuffer をコピー作成 (ゼロコピーまたは高速転送)
    const bufferCopy = image.data.buffer.slice(0) as ArrayBuffer;

    const input: WorkerTraceInput = {
      requestId,
      width: image.width,
      height: image.height,
      buffer: bufferCopy,
      tolerance: options.tolerance,
      ignoreWhite: options.ignoreWhite,
    };

    workerRef.current.postMessage(input, [input.buffer]);
  }, []);

  return {
    svgString,
    isProcessing,
    requestTrace,
  };
}
