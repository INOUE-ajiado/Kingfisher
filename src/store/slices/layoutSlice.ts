/**
 * 作業領域のレイアウト (どの面をどこに、どう重ねて出すか)。
 *
 * ⚠️ 「その面を開いているかどうか」は従来どおり各スライスのフラグが持つ
 * (isSplitView / referenceCanvas.isOpen / roll.isOpen)。
 * これらは連動やファイル読み込みなど広い範囲から参照されているため、
 * ここへ移すと影響範囲が大きすぎる。
 *
 * このスライスが持つのは並び順・重なり・一面表示・幅の取り分だけ。
 * 開閉との同期は syncPaneVisibility が引き受ける。
 */

import { StateCreator } from 'zustand';
import { PaintStore, LayoutSlice } from '../types';
import {
  PaneId,
  createDefaultLayout,
  showPane,
  hidePane,
  setActivePane,
  movePaneToSlot,
  movePaneToIndex,
  swapPanes,
  toggleMaximize,
  setSlotFlex,
  evenOutSlots,
  isPaneVisible,
} from '../../engine/paneLayout';

export const createLayoutSlice: StateCreator<PaintStore, [], [], LayoutSlice> = (set, get) => ({
  paneLayout: createDefaultLayout(),

  /**
   * 開いている面とレイアウトを揃える。
   *
   * 開閉のフラグが変わったときに呼ぶ。ここで吸収しておけば、
   * メニューやショートカットの既存の導線を書き換えずに済む。
   */
  syncPaneVisibility: (visible) => {
    set((state) => {
      let layout = state.paneLayout;

      for (const pane of Object.keys(visible) as PaneId[]) {
        const shouldShow = visible[pane];
        const shown = isPaneVisible(layout, pane);
        if (shouldShow && !shown) layout = showPane(layout, pane);
        else if (!shouldShow && shown) layout = hidePane(layout, pane);
      }

      return layout === state.paneLayout ? state : { paneLayout: layout };
    });
  },

  setActivePaneInSlot: (slotId, pane) =>
    set((state) => ({ paneLayout: setActivePane(state.paneLayout, slotId, pane) })),

  /** 面を別の枠へ重ねる (タブとして移す) */
  stackPaneOnSlot: (pane, slotId) =>
    set((state) => ({ paneLayout: movePaneToSlot(state.paneLayout, pane, slotId) })),

  /** 面を独立した枠として、指定の位置へ差し込む */
  movePaneToPosition: (pane, index) =>
    set((state) => ({ paneLayout: movePaneToIndex(state.paneLayout, pane, index) })),

  swapPanePositions: (a, b) => set((state) => ({ paneLayout: swapPanes(state.paneLayout, a, b) })),

  toggleMaximizedPane: (pane) =>
    set((state) => ({ paneLayout: toggleMaximize(state.paneLayout, pane) })),

  setPaneSlotFlex: (slotId, flexGrow) =>
    set((state) => ({ paneLayout: setSlotFlex(state.paneLayout, slotId, flexGrow) })),

  evenOutPaneSlots: () => set((state) => ({ paneLayout: evenOutSlots(state.paneLayout) })),

  resetPaneLayout: () => {
    // 開いている面はそのままに、並びだけ既定へ戻す
    const { isWinAVisible, isSplitView, referenceCanvas, roll } = get();
    let layout = createDefaultLayout();
    if (isWinAVisible) layout = showPane(layout, 'winA');
    if (isSplitView) layout = showPane(layout, 'winB');
    if (referenceCanvas.isOpen) layout = showPane(layout, 'reference');
    if (roll.views.rollA.isOpen) layout = showPane(layout, 'rollA');
    if (roll.views.rollB.isOpen) layout = showPane(layout, 'rollB');
    set({ paneLayout: layout });
  },
});
