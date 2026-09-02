import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePaintStore } from './usePaintStore';

/**
 * 再生を始める前に、未保存の編集を確認する。
 *
 * ⚠️ 再生中は confirmDiscardIfDirty が素通りする (毎コマ確認を出さないため)。
 * 開始時に止めないと、最初のコマ送りで塗りが黙って消える
 * (2026-09-03 の監査で「確認なし / 履歴が消える / 未保存フラグが落ちる」を再現した)。
 */

// node 環境には window が無いので、確認ダイアログだけ用意する
(globalThis as any).window = (globalThis as any).window ?? { confirm: () => true };

const s = () => usePaintStore.getState();
const initial = usePaintStore.getState();

beforeEach(() => {
  usePaintStore.setState(initial, true);
});

describe('再生を始めるとき', () => {
  it('未保存があれば確認し、断られたら再生しない', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    usePaintStore.setState({ isDirtyA: true, isPlaying: false });

    s().setIsPlaying(true);

    expect(confirmSpy).toHaveBeenCalled();
    expect(s().isPlaying).toBe(false);
    // ⚠️ 断ったのだから、編集はそのまま残っていること
    expect(s().isDirtyA).toBe(true);
    confirmSpy.mockRestore();
  });

  it('破棄してよいと答えたら再生する', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    usePaintStore.setState({ isDirtyA: true, isPlaying: false });

    s().setIsPlaying(true);

    expect(s().isPlaying).toBe(true);
    confirmSpy.mockRestore();
  });

  it('未保存が無ければ黙って再生する', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    usePaintStore.setState({ isDirtyA: false, isDirtyB: false, isPlaying: false });

    s().setIsPlaying(true);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(s().isPlaying).toBe(true);
    confirmSpy.mockRestore();
  });

  it('2 画面のときは Win B の未保存も見る', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    usePaintStore.setState({ isSplitView: true, isDirtyA: false, isDirtyB: true, isPlaying: false });

    s().setIsPlaying(true);

    expect(confirmSpy).toHaveBeenCalled();
    expect(s().isPlaying).toBe(false);
    confirmSpy.mockRestore();
  });

  it('止めるときは何も聞かない', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    usePaintStore.setState({ isDirtyA: true, isPlaying: true });

    s().setIsPlaying(false);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(s().isPlaying).toBe(false);
    confirmSpy.mockRestore();
  });
});

/**
 * ライトテーブルの ID。
 * ⚠️ 重複すると「1 つ消したつもりが 2 つ消える」(2026-09-03 の監査で再現)。
 */
describe('ライトテーブルへの追加', () => {
  const img = { width: 1, height: 1, pixelDepth: 32, data: new Uint8ClampedArray(4) } as any;

  it('続けて足しても ID が重ならない', () => {
    s().addLightTableSubItem('a.tga', new File([], 'a.tga'), img);
    s().addLightTableSubItem('b.tga', new File([], 'b.tga'), img);

    const items = s().lightTable.items;
    expect(items).toHaveLength(2);
    expect(items[0].id).not.toBe(items[1].id);
  });

  it('1 つ消しても、もう 1 つは残る', () => {
    s().addLightTableSubItem('a.tga', new File([], 'a.tga'), img);
    s().addLightTableSubItem('b.tga', new File([], 'b.tga'), img);

    s().removeLightTableSubItem(s().lightTable.items[0].id);

    expect(s().lightTable.items).toHaveLength(1);
    expect(s().lightTable.items[0].name).toBe('b.tga');
  });
});
