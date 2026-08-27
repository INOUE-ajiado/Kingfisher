import { describe, it, expect } from 'vitest';
import {
  createDefaultLayout,
  createSlot,
  showPane,
  hidePane,
  togglePane,
  setActivePane,
  movePaneToSlot,
  movePaneToIndex,
  moveSlot,
  swapPanes,
  toggleMaximize,
  setSlotFlex,
  evenOutSlots,
  isPaneVisible,
  visiblePanes,
  findSlotOf,
  PaneLayout,
} from './paneLayout';

/**
 * 作業領域のレイアウト。
 *
 * 並び順・表示/非表示・重なりをここが一手に持つので、
 * 「面が消える」「入れ替えたら戻せない」といった事故を全部ここで潰しておく。
 */

/** 面の並びを読みやすい形にする */
function shape(layout: PaneLayout): string[] {
  return layout.slots.map((s) => s.panes.map((p) => (p === s.activePane ? `[${p}]` : p)).join('+'));
}

function layoutOf(...groups: string[][]): PaneLayout {
  return { slots: groups.map((g) => createSlot(g as any)), maximized: null };
}

describe('初期状態', () => {
  it('何も開いていない', () => {
    // Win A を最初から置くと、空のまま場所を取って他の面を並べられない
    const layout = createDefaultLayout();
    expect(shape(layout)).toEqual([]);
    expect(isPaneVisible(layout, 'winA')).toBe(false);
  });
});

describe('表示と非表示', () => {
  it('面を足すと右端に枠が増える', () => {
    let layout = createDefaultLayout();
    layout = showPane(layout, 'winA');
    layout = showPane(layout, 'winB');
    layout = showPane(layout, 'rollA');
    expect(shape(layout)).toEqual(['[winA]', '[winB]', '[rollA]']);
  });

  it('閉じると枠ごと消える', () => {
    let layout = layoutOf(['winA'], ['winB'], ['roll']);
    layout = hidePane(layout, 'winB');
    expect(shape(layout)).toEqual(['[winA]', '[roll]']);
  });

  it('最後の 1 枚も閉じられる', () => {
    // 残すと、居座った面が空のまま消せなくなり他の面を並べられない。
    // 全部閉じたら作業領域は空の案内になる
    const layout = hidePane(layoutOf(['winA']), 'winA');
    expect(shape(layout)).toEqual([]);
  });

  it('開いている面をもう一度指定しても増えない', () => {
    const layout = showPane(layoutOf(['winA']), 'winA');
    expect(shape(layout)).toEqual(['[winA]']);
  });

  it('トグルで出したりしまったりできる', () => {
    let layout = layoutOf(['winA'], ['winB']);
    layout = togglePane(layout, 'winB');
    expect(isPaneVisible(layout, 'winB')).toBe(false);
    layout = togglePane(layout, 'winB');
    expect(isPaneVisible(layout, 'winB')).toBe(true);
  });
});

describe('タブとして重ねる', () => {
  it('別の枠へ重ねると、移した面が表示中になる', () => {
    let layout = layoutOf(['winA'], ['roll']);
    const target = layout.slots[0].id;
    layout = movePaneToSlot(layout, 'roll', target);
    expect(shape(layout)).toEqual(['winA+[roll]']);
  });

  it('重ねた側でタブを切り替えられる', () => {
    let layout = layoutOf(['winA', 'roll']);
    layout = setActivePane(layout, layout.slots[0].id, 'winA');
    expect(shape(layout)).toEqual(['[winA]+roll']);
  });

  it('重なりから 1 枚を引き出して独立した枠にできる', () => {
    let layout = layoutOf(['winA', 'roll']);
    layout = movePaneToIndex(layout, 'roll', 0);
    expect(shape(layout)).toEqual(['[roll]', '[winA]']);
  });

  it('重なりの表示中の面を閉じると、残りが出る', () => {
    let layout = layoutOf(['winA', 'roll']);
    layout = setActivePane(layout, layout.slots[0].id, 'roll');
    layout = hidePane(layout, 'roll');
    expect(shape(layout)).toEqual(['[winA]']);
  });

  it('自分しかいない枠へ重ねようとしても壊れない', () => {
    const layout = layoutOf(['winA'], ['roll']);
    const same = movePaneToSlot(layout, 'winA', layout.slots[0].id);
    expect(shape(same)).toEqual(shape(layout));
  });
});

describe('位置の入れ替え', () => {
  it('Win A と Win B を入れ替える', () => {
    let layout = layoutOf(['winA'], ['winB']);
    layout = swapPanes(layout, 'winA', 'winB');
    expect(shape(layout)).toEqual(['[winB]', '[winA]']);
  });

  it('3 面のうち両端を入れ替えても真ん中は動かない', () => {
    let layout = layoutOf(['winA'], ['winB'], ['reference']);
    layout = swapPanes(layout, 'winA', 'reference');
    expect(shape(layout)).toEqual(['[reference]', '[winB]', '[winA]']);
  });

  it('枠ごと左右へ動かせる', () => {
    let layout = layoutOf(['winA'], ['winB'], ['roll']);
    layout = moveSlot(layout, layout.slots[2].id, 0);
    expect(shape(layout)).toEqual(['[roll]', '[winA]', '[winB]']);
  });

  it('好きな位置へ差し込める', () => {
    let layout = layoutOf(['winA'], ['winB'], ['reference']);
    layout = movePaneToIndex(layout, 'reference', 1);
    expect(shape(layout)).toEqual(['[winA]', '[reference]', '[winB]']);
  });

  it('範囲外の位置を指定しても端に収まる', () => {
    let layout = layoutOf(['winA'], ['winB']);
    layout = movePaneToIndex(layout, 'winA', 99);
    expect(shape(layout)).toEqual(['[winB]', '[winA]']);
  });
});

describe('一面表示', () => {
  it('指定した面だけが出る', () => {
    let layout = layoutOf(['winA'], ['winB'], ['roll']);
    layout = toggleMaximize(layout, 'roll');
    expect(visiblePanes(layout)).toEqual(['roll']);
  });

  it('もう一度指定すると元の並びに戻る', () => {
    let layout = layoutOf(['winA'], ['winB'], ['roll']);
    layout = toggleMaximize(layout, 'roll');
    layout = toggleMaximize(layout, 'roll');
    expect(visiblePanes(layout)).toEqual(['winA', 'winB', 'roll']);
    expect(shape(layout)).toEqual(['[winA]', '[winB]', '[roll]']);
  });

  it('一面表示中の面を閉じたら通常表示へ戻す', () => {
    // 閉じた面を一面表示したままだと、何も映らない画面になる
    let layout = layoutOf(['winA'], ['roll']);
    layout = toggleMaximize(layout, 'roll');
    layout = hidePane(layout, 'roll');
    expect(layout.maximized).toBeNull();
    expect(visiblePanes(layout)).toEqual(['winA']);
  });

  it('出ていない面は一面表示にできない', () => {
    const layout = toggleMaximize(layoutOf(['winA']), 'roll');
    expect(layout.maximized).toBeNull();
  });
});

describe('横幅の取り分', () => {
  it('枠ごとに変えられる', () => {
    let layout = layoutOf(['winA'], ['roll']);
    layout = setSlotFlex(layout, layout.slots[1].id, 3);
    expect(layout.slots[1].flexGrow).toBe(3);
  });

  it('極端な値は丸める', () => {
    let layout = layoutOf(['winA']);
    const id = layout.slots[0].id;
    expect(setSlotFlex(layout, id, 0).slots[0].flexGrow).toBeGreaterThan(0);
    expect(setSlotFlex(layout, id, 999).slots[0].flexGrow).toBeLessThanOrEqual(10);
  });

  it('均等に戻せる', () => {
    let layout = layoutOf(['winA'], ['roll']);
    layout = setSlotFlex(layout, layout.slots[0].id, 5);
    expect(evenOutSlots(layout).slots.every((s) => s.flexGrow === 1)).toBe(true);
  });
});

describe('不変条件', () => {
  it('表示中の面は必ずその枠に含まれる', () => {
    let layout = layoutOf(['winA', 'winB', 'roll']);
    const id = layout.slots[0].id;
    layout = setActivePane(layout, id, 'roll');
    layout = hidePane(layout, 'roll');
    const slot = layout.slots[0];
    expect(slot.panes).toContain(slot.activePane);
  });

  it('同じ面が 2 か所に現れない', () => {
    let layout = layoutOf(['winA'], ['winB'], ['roll']);
    layout = movePaneToSlot(layout, 'roll', layout.slots[0].id);
    layout = movePaneToIndex(layout, 'roll', 2);
    const all = layout.slots.flatMap((s) => s.panes);
    expect(new Set(all).size).toBe(all.length);
  });

  it('枠の識別子は重複しない', () => {
    let layout = layoutOf(['winA']);
    layout = showPane(layout, 'winB');
    layout = showPane(layout, 'roll');
    const ids = layout.slots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('存在しない面や枠を指定しても落ちない', () => {
    const layout = layoutOf(['winA']);
    expect(() => setActivePane(layout, 'なし', 'winA')).not.toThrow();
    expect(() => movePaneToSlot(layout, 'roll', 'なし')).not.toThrow();
    expect(() => moveSlot(layout, 'なし', 0)).not.toThrow();
    expect(findSlotOf(layout, 'roll')).toBeNull();
  });
});
