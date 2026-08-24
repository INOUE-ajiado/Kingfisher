import { describe, it, expect, beforeEach } from 'vitest';
import { usePaintStore } from './usePaintStore';
import { TGAImage } from '../engine/tga';

/**
 * 操作履歴 (Undo / Redo) のテスト。
 *
 * 不変条件は「historyStack[historyIndex] は常に表示中の状態」。
 * saveUndoState は操作の *直前* に呼ばれるため、履歴末尾の内容は
 * commitLiveState() によって遅延で同期される。この仕組みが正しく働くかを確認する。
 */

const s = () => usePaintStore.getState();

function makeImage(fill: number): TGAImage {
  return { width: 4, height: 4, pixelDepth: 32, data: new Uint8ClampedArray(64).fill(fill) };
}

/** Win A の画像の代表値 */
const valueA = () => s().currentImage!.data[0];
/** Win A の履歴ラベル一覧 */
const labelsA = () => s().historyStack.map((h) => h.label).join(' → ');

/**
 * 1 回の「操作」を模す。
 * 実際の呼び出し側 (CellWindow / editSlice) と同じく、
 * saveUndoState を呼んでから画像を書き換える。
 */
function paint(label: string, value: number) {
  s().saveUndoState(label);
  s().getActiveImage()!.data.fill(value);
}

beforeEach(() => {
  usePaintStore.setState({
    currentImage: makeImage(0),
    splitImage: null,
    activeViewIndex: 0,
    historyStack: [],
    historyIndex: -1,
    splitHistoryStack: [],
    splitHistoryIndex: -1,
    isDirtyA: false,
    isDirtyB: false,
  });
});

describe('基準状態', () => {
  it('最初の操作で「編集前」が基準として積まれる', () => {
    paint('バケツ塗り', 10);
    expect(labelsA()).toBe('編集前 → バケツ塗り');
    expect(s().historyIndex).toBe(1);
  });

  it('1 回目の操作も Undo で取り消せる', () => {
    paint('バケツ塗り', 10);
    expect(valueA()).toBe(10);

    s().undo();
    expect(valueA()).toBe(0);
    expect(s().historyIndex).toBe(0);
  });

  it('Undo した直後に Redo で戻せる', () => {
    paint('バケツ塗り', 10);
    s().undo();
    s().redo();
    expect(valueA()).toBe(10);
    expect(s().historyIndex).toBe(1);
  });
});

describe('Undo / Redo は 1 手ずつ進む', () => {
  beforeEach(() => {
    paint('塗り1', 10);
    paint('塗り2', 20);
    paint('塗り3', 30);
  });

  it('操作 3 回で履歴は 4 件になる', () => {
    expect(labelsA()).toBe('編集前 → 塗り1 → 塗り2 → 塗り3');
    expect(valueA()).toBe(30);
  });

  it('Undo が 1 手ずつ遡る', () => {
    s().undo();
    expect(valueA()).toBe(20);
    s().undo();
    expect(valueA()).toBe(10);
    s().undo();
    expect(valueA()).toBe(0);
  });

  it('基準状態より前へは戻らない', () => {
    s().undo();
    s().undo();
    s().undo();
    s().undo();
    expect(valueA()).toBe(0);
    expect(s().historyIndex).toBe(0);
  });

  it('Redo が 1 手ずつ進む', () => {
    s().undo();
    s().undo();
    s().undo();

    s().redo();
    expect(valueA()).toBe(10);
    s().redo();
    expect(valueA()).toBe(20);
    s().redo();
    expect(valueA()).toBe(30);
  });

  it('最新より先へは進まない', () => {
    s().redo();
    expect(valueA()).toBe(30);
    expect(s().historyIndex).toBe(3);
  });
});

describe('Undo 後に新しい操作をした場合', () => {
  it('やり直し (Redo) 先が破棄されて分岐する', () => {
    paint('塗り1', 10);
    paint('塗り2', 20);
    paint('塗り3', 30);

    s().undo();
    s().undo();
    expect(valueA()).toBe(10);

    paint('分岐塗り', 99);

    expect(labelsA()).toBe('編集前 → 塗り1 → 分岐塗り');
    expect(valueA()).toBe(99);
  });

  it('分岐後は Redo できず、Undo で分岐前へ戻る', () => {
    paint('塗り1', 10);
    paint('塗り2', 20);
    s().undo();
    paint('分岐塗り', 99);

    s().redo();
    expect(valueA()).toBe(99); // 進む先が無い

    s().undo();
    expect(valueA()).toBe(10); // 分岐前へ
  });
});

describe('ヒストリーパネルからの直接ジャンプ', () => {
  beforeEach(() => {
    paint('塗り1', 10);
    paint('塗り2', 20);
    paint('塗り3', 30);
  });

  it('任意の履歴へ飛べる', () => {
    s().jumpToHistory(1);
    expect(valueA()).toBe(10);
    s().jumpToHistory(3);
    expect(valueA()).toBe(30);
    s().jumpToHistory(0);
    expect(valueA()).toBe(0);
  });

  it('範囲外の指定は無視される', () => {
    s().jumpToHistory(-1);
    expect(valueA()).toBe(30);
    s().jumpToHistory(99);
    expect(valueA()).toBe(30);
  });
});

describe('Win A / Win B の履歴は独立している', () => {
  beforeEach(() => {
    usePaintStore.setState({
      currentImage: makeImage(1),
      splitImage: makeImage(2),
      activeViewIndex: 0,
      historyStack: [],
      historyIndex: -1,
      splitHistoryStack: [],
      splitHistoryIndex: -1,
    });
  });

  it('アクティブなビュー側の履歴だけが伸びる', () => {
    paint('A塗り', 11);
    expect(s().historyStack.length).toBe(2);
    expect(s().splitHistoryStack.length).toBe(0);

    usePaintStore.setState({ activeViewIndex: 1 });
    paint('B塗り', 22);
    expect(s().splitHistoryStack.length).toBe(2);
    expect(s().historyStack.length).toBe(2); // A は増えない
  });

  it('Undo が相手側の画像を巻き込まない', () => {
    paint('A塗り', 11);
    usePaintStore.setState({ activeViewIndex: 1 });
    paint('B塗り', 22);

    s().undo(); // Win B の Undo
    expect(s().splitImage!.data[0]).toBe(2);
    expect(s().currentImage!.data[0]).toBe(11); // A は無傷

    usePaintStore.setState({ activeViewIndex: 0 });
    s().undo(); // Win A の Undo
    expect(s().currentImage!.data[0]).toBe(1);
    expect(s().splitImage!.data[0]).toBe(2); // B は無傷
  });

  it('未保存フラグもビューごとに分かれる', () => {
    paint('A塗り', 11);
    expect(s().isDirtyA).toBe(true);
    expect(s().isDirtyB).toBe(false);
  });
});

describe('履歴の上限', () => {
  it('30 件で頭打ちになり、それでも Undo は 1 手戻る', () => {
    for (let i = 1; i <= 40; i++) paint(`塗り${i}`, i);

    expect(s().historyStack.length).toBe(30);
    expect(s().historyIndex).toBe(29);
    expect(valueA()).toBe(40);

    s().undo();
    expect(valueA()).toBe(39);
  });
});

describe('画像が無いとき', () => {
  beforeEach(() => {
    usePaintStore.setState({ currentImage: null, historyStack: [], historyIndex: -1 });
  });

  it('履歴は積まれない', () => {
    s().saveUndoState('無効な操作');
    expect(s().historyStack.length).toBe(0);
  });

  it('undo / redo / jumpToHistory が例外を投げない', () => {
    expect(() => {
      s().undo();
      s().redo();
      s().jumpToHistory(0);
      s().commitLiveState();
    }).not.toThrow();
  });
});
