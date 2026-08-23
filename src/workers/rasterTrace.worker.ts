import { RasterTraceOptions, processRasterTrace } from '../engine/rasterTrace';

export interface WorkerRasterInput {
  requestId: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  options: RasterTraceOptions;
}

export interface WorkerRasterOutput {
  requestId: number;
  width: number;
  height: number;
  processedBuffer: ArrayBuffer;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRasterInput>) => {
  const { requestId, width, height, buffer, options } = e.data;

  try {
    const rawData = new Uint8ClampedArray(buffer);
    const imageObj = { width, height, pixelDepth: 32, data: rawData };

    const processedData = processRasterTrace(imageObj, options);
    const outBuffer = processedData.buffer.slice(0) as ArrayBuffer;

    const output: WorkerRasterOutput = {
      requestId,
      width,
      height,
      processedBuffer: outBuffer,
    };

    // ゼロコピー ArrayBuffer 転送
    (self as any).postMessage(output, [output.processedBuffer]);
  } catch (err: any) {
    self.postMessage({
      requestId,
      width,
      height,
      processedBuffer: new ArrayBuffer(0),
      error: err.message || 'Raster worker processing error',
    });
  }
};
