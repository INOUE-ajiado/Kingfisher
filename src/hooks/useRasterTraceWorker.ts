import { useState, useEffect, useRef, useCallback } from 'react';
import { TGAImage } from '../engine/tga';
import { RasterTraceOptions } from '../engine/rasterTrace';
import { WorkerRasterInput, WorkerRasterOutput } from '../workers/rasterTrace.worker';

export function useRasterTraceWorker() {
  const [processedBuffer, setProcessedBuffer] = useState<Uint8ClampedArray | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/rasterTrace.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerRasterOutput>) => {
      const { requestId, processedBuffer, error } = e.data;

      if (requestId === activeRequestIdRef.current) {
        if (!error) {
          setProcessedBuffer(new Uint8ClampedArray(processedBuffer));
        } else {
          console.error('Raster Trace Worker error:', error);
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

  const requestRasterTrace = useCallback((image: TGAImage | null, options: RasterTraceOptions) => {
    if (!image || !workerRef.current) {
      setProcessedBuffer(null);
      setIsProcessing(false);
      return;
    }

    setIsProcessing(true);
    const requestId = ++activeRequestIdRef.current;
    const bufferCopy = image.data.buffer.slice(0) as ArrayBuffer;

    const input: WorkerRasterInput = {
      requestId,
      width: image.width,
      height: image.height,
      buffer: bufferCopy,
      options,
    };

    workerRef.current.postMessage(input, [input.buffer]);
  }, []);

  return {
    processedBuffer,
    isProcessing,
    requestRasterTrace,
  };
}
