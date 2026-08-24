/**
 * TGA デコード専用ワーカー。
 *
 * 4K セルの TGA デコードはメインスレッドで数十 ms かかり、その間 UI が固まる。
 * コマ送り時のカクつきを避けるため、デコードだけをこのワーカーへ逃がす。
 *
 * 呼び出し側は usePrefetchWorker フック経由で使う。
 */

import { decodeTGA } from '../engine/tga';

export interface PrefetchRequest {
  id: number;
  buffer: ArrayBuffer;
}

export interface PrefetchResponse {
  id: number;
  success: boolean;
  width?: number;
  height?: number;
  pixelDepth?: number;
  data?: Uint8ClampedArray;
  error?: string;
}

self.onmessage = (e: MessageEvent<PrefetchRequest>) => {
  const { id, buffer } = e.data;

  try {
    const decoded = decodeTGA(buffer);
    const response: PrefetchResponse = {
      id,
      success: true,
      width: decoded.width,
      height: decoded.height,
      pixelDepth: decoded.pixelDepth,
      data: decoded.data,
    };
    // 画素配列はコピーせず所有権ごと渡す (4K で 35MB のコピーを回避)
    (self as any).postMessage(response, [decoded.data.buffer]);
  } catch (err: any) {
    const response: PrefetchResponse = {
      id,
      success: false,
      error: err?.message || String(err),
    };
    self.postMessage(response);
  }
};
