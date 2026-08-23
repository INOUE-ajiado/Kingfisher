import { useState, useEffect, useRef, useCallback } from 'react';
import { TGAImage } from '../engine/tga';
import { VectorExportOptions } from '../engine/vectorTrace';
import { WorkerTraceInput, WorkerMessageOut } from '../workers/vectorTrace.worker';

export function useVectorTraceWorker() {
  const [svgString, setSvgString] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  const addLog = useCallback((logMsg: string) => {
    setDebugLogs((prev) => [...prev.slice(-99), logMsg]); // 最大100行を保持
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/vectorTrace.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerMessageOut>) => {
      const data = e.data;

      // リクエストIDが最新の場合のみ採用
      if (data.requestId === activeRequestIdRef.current) {
        if (data.type === 'PROGRESS') {
          setProgressPercent(data.percent);
          setStatusMessage(data.message);
          if (data.log) addLog(data.log);
        } else if (data.type === 'SUCCESS') {
          setSvgString(data.svgString);
          setProgressPercent(100);
          setStatusMessage('完了');
          if (data.log) addLog(data.log);
          setIsProcessing(false);
        } else if (data.type === 'ERROR') {
          console.error('Vector Worker error:', data.error);
          if (data.log) addLog(data.log);
          setIsProcessing(false);
        }
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [addLog]);

  const requestTrace = useCallback((image: TGAImage | null, options: VectorExportOptions) => {
    if (!image || !workerRef.current) {
      setSvgString('');
      setIsProcessing(false);
      setProgressPercent(0);
      setStatusMessage('');
      return;
    }

    setIsProcessing(true);
    setProgressPercent(0);
    setStatusMessage('準備中...');

    const requestId = ++activeRequestIdRef.current;
    const bufferCopy = image.data.buffer.slice(0) as ArrayBuffer;

    const timeStr = new Date().toLocaleTimeString('ja-JP');
    setDebugLogs([`[INFO] ${timeStr}: Start vector trace task #${requestId}`]);

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
    progressPercent,
    statusMessage,
    debugLogs,
    requestTrace,
  };
}
