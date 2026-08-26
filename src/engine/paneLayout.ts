/**
 * 作業領域のレイアウト。
 *
 * Win A / Win B / 見本 / ロールを「横一列に並んだ枠 (スロット)」へ割り当てて表す。
 * 1 つのスロットには複数の面を重ねられ、タブで切り替える。
 *
 * ⚠️ 表示位置を JSX に固定しないこと。以前は CellWindow の JSX に
 * Win A → Win B → 見本 → ロール の順が直接書かれており、入れ替えも
 * 一面表示もできなかった。並び順・表示/非表示・重なりはすべてここが持つ。
 *
 * ここは純粋なデータ操作だけを扱う。DOM も React も触らない。
 */

/** 作業領域に置ける面 */
export type PaneId = 'winA' | 'winB' | 'reference' | 'roll';

export const ALL_PANES: PaneId[] = ['winA', 'winB', 'reference', 'roll'];

export const PANE_LABELS: Record<PaneId, string> = {
  winA: 'Win A',
  winB: 'Win B',
  reference: '見本',
  roll: 'ロール',
};

/** 横一列に並ぶ枠。中に複数の面を重ねられる */
export interface PaneSlot {
  id: string;
  /** 重なっている面。先頭から順にタブとして並ぶ */
  panes: PaneId[];
  /** 表示中の面。必ず panes に含まれる */
  activePane: PaneId;
  /** 横幅の取り分 */
  flexGrow: number;
}

export interface PaneLayout {
  slots: PaneSlot[];
  /** 一面表示にしている面。null なら通常表示 */
  maximized: PaneId | null;
}

let slotSeq = 0;
/** スロットの識別子。並べ替えても React のキーが安定するよう連番で振る */
export function nextSlotId(): string {
  slotSeq += 1;
  return `slot-${slotSeq}`;
}

export function createSlot(panes: PaneId[], flexGrow = 1): PaneSlot {
  return { id: nextSlotId(), panes: [...panes], activePane: panes[0], flexGrow };
}

/** 起動時のレイアウト。Win A だけを開いた状態から始める */
export function createDefaultLayout(): PaneLayout {
  return { slots: [createSlot(['winA'])], maximized: null };
}

/** その面が今どのスロットにいるか (いなければ null) */
export function findSlotOf(layout: PaneLayout, pane: PaneId): PaneSlot | null {
  return layout.slots.find((s) => s.panes.includes(pane)) ?? null;
}

export function isPaneVisible(layout: PaneLayout, pane: PaneId): boolean {
  return findSlotOf(layout, pane) !== null;
}

/** 実際に画面へ出ている面 (一面表示中はその 1 つだけ) */
export function visiblePanes(layout: PaneLayout): PaneId[] {
  if (layout.maximized && isPaneVisible(layout, layout.maximized)) return [layout.maximized];
  return layout.slots.map((s) => s.activePane);
}

/**
 * 面を取り除いたレイアウトを返す。
 * 空になったスロットは畳む。最後の 1 枚は残す (何も無い画面にしない)。
 */
function withoutPane(layout: PaneLayout, pane: PaneId): PaneLayout {
  const slots = layout.slots
    .map((slot) => {
      if (!slot.panes.includes(pane)) return slot;
      const panes = slot.panes.filter((p) => p !== pane);
      if (panes.length === 0) return null;
      // 表示中の面を抜いたら、残りの先頭へ寄せる
      const activePane = slot.activePane === pane ? panes[0] : slot.activePane;
      return { ...slot, panes, activePane };
    })
    .filter((s): s is PaneSlot => s !== null);

  return {
    slots,
    maximized: layout.maximized === pane ? null : layout.maximized,
  };
}

/** 面を表示する。既に出ていれば、そのスロットの表示中の面にする */
export function showPane(layout: PaneLayout, pane: PaneId): PaneLayout {
  const slot = findSlotOf(layout, pane);
  if (slot) {
    return {
      ...layout,
      slots: layout.slots.map((s) => (s.id === slot.id ? { ...s, activePane: pane } : s)),
    };
  }
  return { ...layout, slots: [...layout.slots, createSlot([pane])] };
}

/** 面を閉じる。最後の 1 枚は閉じさせない */
export function hidePane(layout: PaneLayout, pane: PaneId): PaneLayout {
  if (!isPaneVisible(layout, pane)) return layout;

  const total = layout.slots.reduce((n, s) => n + s.panes.length, 0);
  if (total <= 1) return layout;

  return withoutPane(layout, pane);
}

export function togglePane(layout: PaneLayout, pane: PaneId): PaneLayout {
  return isPaneVisible(layout, pane) ? hidePane(layout, pane) : showPane(layout, pane);
}

/** スロットの中で表示する面を切り替える */
export function setActivePane(layout: PaneLayout, slotId: string, pane: PaneId): PaneLayout {
  return {
    ...layout,
    slots: layout.slots.map((s) =>
      s.id === slotId && s.panes.includes(pane) ? { ...s, activePane: pane } : s
    ),
  };
}

/**
 * 面を別のスロットへ重ねる (タブとして移す)。
 * 元のスロットが空になれば畳む。
 */
export function movePaneToSlot(layout: PaneLayout, pane: PaneId, targetSlotId: string): PaneLayout {
  const from = findSlotOf(layout, pane);
  if (!from) return layout;
  if (from.id === targetSlotId && from.panes.length === 1) return layout;
  if (!layout.slots.some((s) => s.id === targetSlotId)) return layout;

  const stripped = withoutPane(layout, pane);
  const target = stripped.slots.find((s) => s.id === targetSlotId);
  if (!target) return layout;

  return {
    ...stripped,
    slots: stripped.slots.map((s) =>
      s.id === targetSlotId ? { ...s, panes: [...s.panes, pane], activePane: pane } : s
    ),
  };
}

/**
 * 面を独立した枠として、指定の位置へ差し込む。
 * index はスロット列の中での位置 (0 が左端)。
 */
export function movePaneToIndex(layout: PaneLayout, pane: PaneId, index: number): PaneLayout {
  const from = findSlotOf(layout, pane);
  const stripped = from ? withoutPane(layout, pane) : layout;

  // 元のスロットが畳まれた分、挿入位置がずれることがあるので丸める
  const at = Math.max(0, Math.min(stripped.slots.length, index));
  const slots = [...stripped.slots];
  slots.splice(at, 0, createSlot([pane]));

  return { ...stripped, slots };
}

/** スロットごと左右へ動かす */
export function moveSlot(layout: PaneLayout, slotId: string, index: number): PaneLayout {
  const current = layout.slots.findIndex((s) => s.id === slotId);
  if (current < 0) return layout;

  const slots = [...layout.slots];
  const [slot] = slots.splice(current, 1);
  slots.splice(Math.max(0, Math.min(slots.length, index)), 0, slot);
  return { ...layout, slots };
}

/** 2 つの面の位置を入れ替える (スロットをまたぐ場合はスロットごと交換) */
export function swapPanes(layout: PaneLayout, a: PaneId, b: PaneId): PaneLayout {
  const slotA = findSlotOf(layout, a);
  const slotB = findSlotOf(layout, b);
  if (!slotA || !slotB) return layout;

  if (slotA.id === slotB.id) {
    // 同じスロットの中ならタブの並びを入れ替える
    const panes = [...slotA.panes];
    const ia = panes.indexOf(a);
    const ib = panes.indexOf(b);
    [panes[ia], panes[ib]] = [panes[ib], panes[ia]];
    return { ...layout, slots: layout.slots.map((s) => (s.id === slotA.id ? { ...s, panes } : s)) };
  }

  const swapIn = (slot: PaneSlot, from: PaneId, to: PaneId): PaneSlot => ({
    ...slot,
    panes: slot.panes.map((p) => (p === from ? to : p)),
    activePane: slot.activePane === from ? to : slot.activePane,
  });

  return {
    ...layout,
    slots: layout.slots.map((s) => {
      if (s.id === slotA.id) return swapIn(s, a, b);
      if (s.id === slotB.id) return swapIn(s, b, a);
      return s;
    }),
  };
}

/** 一面表示の切り替え。既に一面表示中の面をもう一度指定すると戻る */
export function toggleMaximize(layout: PaneLayout, pane: PaneId): PaneLayout {
  if (!isPaneVisible(layout, pane)) return layout;
  return { ...layout, maximized: layout.maximized === pane ? null : pane };
}

/** 枠の横幅の取り分を変える */
export function setSlotFlex(layout: PaneLayout, slotId: string, flexGrow: number): PaneLayout {
  const value = Math.max(0.1, Math.min(10, flexGrow));
  return {
    ...layout,
    slots: layout.slots.map((s) => (s.id === slotId ? { ...s, flexGrow: value } : s)),
  };
}

/** 幅の取り分をすべて等しくする */
export function evenOutSlots(layout: PaneLayout): PaneLayout {
  return { ...layout, slots: layout.slots.map((s) => ({ ...s, flexGrow: 1 })) };
}
