import { decodeTGA } from '../engine/tga';

// Web Worker for background cell prefetching
self.onmessage = async (e: MessageEvent) => {
  const { fileName, arrayBuffer } = e.data;
  try {
    const decoded = decodeTGA(arrayBuffer);
    self.postMessage({
      fileName,
      success: true,
      image: decoded,
    });
  } catch (err: any) {
    self.postMessage({
      fileName,
      success: false,
      error: err.message,
    });
  }
};
