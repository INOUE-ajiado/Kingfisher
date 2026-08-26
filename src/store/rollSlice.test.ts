import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { usePaintStore } from './usePaintStore';

/**
 * ロール再生の状態。
 *
 * ここで守りたいのは 2 つ。
 *  - blob URL を必ず手放すこと (数 GB のロールを何本も開く使い方をする)
 *  - 再生できないときに「なぜ / どうすれば」まで出すこと
 */

const s = () => usePaintStore.getState();

/** ISO-BMFF の箱を 1 つ組み立てる */
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function stsd(format: string): Uint8Array {
  const payload = new Uint8Array(20);
  new DataView(payload.buffer).setUint32(4, 1); // entry_count
  new DataView(payload.buffer).setUint32(8, 16); // entry size
  for (let i = 0; i < 4; i++) payload[12 + i] = format.charCodeAt(i);
  return box('stsd', payload);
}

/** 末尾に moov を持つ .mov を模したファイル */
function movFile(format: string, name = 'A_part_t1.mov'): File {
  const bytes = [box('ftyp', new Uint8Array(4)), box('mdat', new Uint8Array(256)), box('moov', box('trak', stsd(format)))];
  return new File(bytes as unknown as BlobPart[], name, { type: 'video/quicktime' });
}

let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  const emptyView = () => ({
    isOpen: false,
    isFloating: false,
    fileName: '',
    file: null,
    objectUrl: null,
    currentPath: null,
    status: 'idle' as const,
    message: '',
    codec: null,
    fps: 24,
    fpsSource: 'default' as const,
  });
  usePaintStore.setState({
    roll: {
      files: [],
      folderName: '',
      views: { rollA: emptyView(), rollB: emptyView() },
      activeId: 'rollA',
      sync: false,
      syncOffset: 0,
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('ロールの読み込み', () => {
  it('開くとウィンドウが出て、再生用の URL ができる', () => {
    s().loadRollFile('rollA', movFile('avc1'));

    expect(s().roll.views.rollA.isOpen).toBe(true);
    expect(s().roll.views.rollA.fileName).toBe('A_part_t1.mov');
    expect(s().roll.views.rollA.objectUrl).toBe(created[0]);
    // まず再生させてみる方針なので、この時点では ready
    expect(s().roll.views.rollA.status).toBe('ready');
  });

  it('差し替えると前の URL を手放す', () => {
    s().loadRollFile('rollA', movFile('avc1', 'first.mov'));
    s().loadRollFile('rollA', movFile('avc1', 'second.mov'));

    expect(revoked).toEqual([created[0]]);
    expect(s().roll.views.rollA.objectUrl).toBe(created[1]);
  });

  it('閉じると URL を手放し、素材だけ捨てる', () => {
    s().toggleRollFloating('rollA');
    s().loadRollFile('rollA', movFile('avc1'));
    s().closeRollWindow('rollA');

    expect(revoked).toContain(created[0]);
    expect(s().roll.views.rollA.objectUrl).toBeNull();
    expect(s().roll.views.rollA.fileName).toBe('');
    // ウィンドウの切り離し状態は次に開いたときのために残す
    expect(s().roll.views.rollA.isFloating).toBe(true);
  });
});

describe('再生できないコーデック', () => {
  it('ProRes ならコーデック名と変換コマンドを出す', async () => {
    s().loadRollFile('rollA', movFile('apch'));
    await s().reportRollPlaybackFailure('rollA');

    const { status, message, codec } = s().roll.views.rollA;
    expect(status).toBe('unsupported');
    expect(codec?.label).toContain('ProRes');
    expect(message).toContain('ProRes');
    expect(message).toContain('ffmpeg');
    // 入力ファイル名がそのまま使えるコマンドになっていること
    expect(message).toContain('A_part_t1.mov');
  });

  it('判別できなくても黙らず、打つ手を出す', async () => {
    s().loadRollFile('rollA', new File([new Uint8Array(32)] as unknown as BlobPart[], 'broken.mov'));
    await s().reportRollPlaybackFailure('rollA');

    expect(s().roll.views.rollA.status).toBe('error');
    expect(s().roll.views.rollA.message).toContain('ffmpeg');
  });

  it('素材が無ければ何もしない', async () => {
    await s().reportRollPlaybackFailure('rollA');
    expect(s().roll.views.rollA.status).toBe('idle');
  });
});

describe('コマ送りの基準 fps', () => {
  it('自動推定を採り込む', () => {
    s().setRollFps('rollA', 23.976, 'auto');
    expect(s().roll.views.rollA.fps).toBe(23.976);
    expect(s().roll.views.rollA.fpsSource).toBe('auto');
  });

  it('手動で決めた値を自動推定で上書きしない', () => {
    s().setRollFps('rollA', 25, 'manual');
    s().setRollFps('rollA', 29.97, 'auto');

    expect(s().roll.views.rollA.fps).toBe(25);
    expect(s().roll.views.rollA.fpsSource).toBe('manual');
  });

  it('ありえない値は受け付けない', () => {
    s().setRollFps('rollA', 0, 'manual');
    s().setRollFps('rollA', Number.NaN, 'manual');
    expect(s().roll.views.rollA.fps).toBe(24);
  });
});

describe('2 面 (修正前 / 修正後の見比べ)', () => {
  it('片方を開いても、もう片方は空のまま', () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));

    expect(s().roll.views.rollA.fileName).toBe('before.mov');
    expect(s().roll.views.rollB.isOpen).toBe(false);
    expect(s().roll.views.rollB.objectUrl).toBeNull();
  });

  it('それぞれ別のロールを開ける', () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));
    s().loadRollFile('rollB', movFile('avc1', 'after.mov'));

    expect(s().roll.views.rollA.fileName).toBe('before.mov');
    expect(s().roll.views.rollB.fileName).toBe('after.mov');
    // それぞれ別の URL を持つ
    expect(s().roll.views.rollA.objectUrl).not.toBe(s().roll.views.rollB.objectUrl);
  });

  it('片方を閉じても、もう片方は残る', () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));
    s().loadRollFile('rollB', movFile('avc1', 'after.mov'));
    s().closeRollWindow('rollB');

    expect(s().roll.views.rollA.fileName).toBe('before.mov');
    expect(s().roll.views.rollB.objectUrl).toBeNull();
    // 閉じた側の URL だけ手放す
    expect(revoked).toEqual([created[1]]);
  });

  it('一覧は 2 面で共有する', () => {
    // ツリーは 1 本しか出ないので、面ごとに持つと中身と食い違う
    const videos = [
      { path: 'Roll/before.mov', file: movFile('avc1', 'before.mov') },
      { path: 'Roll/after.mov', file: movFile('avc1', 'after.mov') },
    ];
    s().setRollFolderFiles(videos, 'Roll');

    s().selectRollFile('rollA', 'Roll/before.mov');
    s().selectRollFile('rollB', 'Roll/after.mov');

    expect(s().roll.files).toHaveLength(2);
    expect(s().roll.views.rollA.currentPath).toBe('Roll/before.mov');
    expect(s().roll.views.rollB.currentPath).toBe('Roll/after.mov');
  });

  it('開いた面がアクティブになる', () => {
    s().loadRollFile('rollB', movFile('avc1'));
    expect(s().roll.activeId).toBe('rollB');
  });
});

describe('連動', () => {
  const openBoth = () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));
    s().loadRollFile('rollB', movFile('avc1', 'after.mov'));
  };

  it('片方しか開いていなければ連動しない', () => {
    s().loadRollFile('rollA', movFile('avc1'));
    s().toggleRollSync(0);
    expect(s().roll.sync).toBe(false);
  });

  it('両方開いていれば連動できる', () => {
    openBoth();
    s().toggleRollSync(0);
    expect(s().roll.sync).toBe(true);
  });

  it('開始時の時刻差を覚える', () => {
    // 片方を頭出ししてから連動させる使い方があるので、差を保つ
    openBoth();
    s().toggleRollSync(1.5);
    expect(s().roll.syncOffset).toBeCloseTo(1.5, 6);
  });

  it('もう一度押すと解除される', () => {
    openBoth();
    s().toggleRollSync(1.5);
    s().toggleRollSync();
    expect(s().roll.sync).toBe(false);
  });
});
