/**
 * Kingfisher グローバルストア (Zustand)。
 *
 * 状態と操作は責務ごとに store/slices/* へ分割してある。
 * このファイルはそれらを 1 つのストアへ合成するだけの薄い層。
 * 各スライスは共通の get を通じて他スライスの値・アクションを参照できる。
 *
 * 型は store/types.ts に集約し、既存の import 互換のためここから再輸出する。
 */

import { create } from 'zustand';
import { PaintStore } from './types';
import { createUiSlice } from './slices/uiSlice';
import { createViewSlice } from './slices/viewSlice';
import { createFileSlice } from './slices/fileSlice';
import { createDocumentSlice } from './slices/documentSlice';
import { createToolSlice } from './slices/toolSlice';
import { createEditSlice } from './slices/editSlice';
import { createLightTableSlice } from './slices/lightTableSlice';

export const usePaintStore = create<PaintStore>()((...a) => ({
  ...createUiSlice(...a),
  ...createViewSlice(...a),
  ...createFileSlice(...a),
  ...createDocumentSlice(...a),
  ...createToolSlice(...a),
  ...createEditSlice(...a),
  ...createLightTableSlice(...a),
}));

export * from './types';
