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
  usePaintStore.setState({
    roll: {
      isOpen: false,
      isFloating: false,
      fileName: '',
      file: null,
      objectUrl: null,
      status: 'idle',
      message: '',
      codec: null,
      fps: 24,
      fpsSource: 'default',
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('ロールの読み込み', () => {
  it('開くとウィンドウが出て、再生用の URL ができる', () => {
    s().loadRollFile(movFile('avc1'));

    expect(s().roll.isOpen).toBe(true);
    expect(s().roll.fileName).toBe('A_part_t1.mov');
    expect(s().roll.objectUrl).toBe(created[0]);
    // まず再生させてみる方針なので、この時点では ready
    expect(s().roll.status).toBe('ready');
  });

  it('差し替えると前の URL を手放す', () => {
    s().loadRollFile(movFile('avc1', 'first.mov'));
    s().loadRollFile(movFile('avc1', 'second.mov'));

    expect(revoked).toEqual([created[0]]);
    expect(s().roll.objectUrl).toBe(created[1]);
  });

  it('閉じると URL を手放し、素材だけ捨てる', () => {
    s().toggleRollFloating();
    s().loadRollFile(movFile('avc1'));
    s().closeRollWindow();

    expect(revoked).toContain(created[0]);
    expect(s().roll.objectUrl).toBeNull();
    expect(s().roll.fileName).toBe('');
    // ウィンドウの切り離し状態は次に開いたときのために残す
    expect(s().roll.isFloating).toBe(true);
  });
});

describe('再生できないコーデック', () => {
  it('ProRes ならコーデック名と変換コマンドを出す', async () => {
    s().loadRollFile(movFile('apch'));
    await s().reportRollPlaybackFailure();

    const { status, message, codec } = s().roll;
    expect(status).toBe('unsupported');
    expect(codec?.label).toContain('ProRes');
    expect(message).toContain('ProRes');
    expect(message).toContain('ffmpeg');
    // 入力ファイル名がそのまま使えるコマンドになっていること
    expect(message).toContain('A_part_t1.mov');
  });

  it('判別できなくても黙らず、打つ手を出す', async () => {
    s().loadRollFile(new File([new Uint8Array(32)] as unknown as BlobPart[], 'broken.mov'));
    await s().reportRollPlaybackFailure();

    expect(s().roll.status).toBe('error');
    expect(s().roll.message).toContain('ffmpeg');
  });

  it('素材が無ければ何もしない', async () => {
    await s().reportRollPlaybackFailure();
    expect(s().roll.status).toBe('idle');
  });
});

describe('コマ送りの基準 fps', () => {
  it('自動推定を採り込む', () => {
    s().setRollFps(23.976, 'auto');
    expect(s().roll.fps).toBe(23.976);
    expect(s().roll.fpsSource).toBe('auto');
  });

  it('手動で決めた値を自動推定で上書きしない', () => {
    s().setRollFps(25, 'manual');
    s().setRollFps(29.97, 'auto');

    expect(s().roll.fps).toBe(25);
    expect(s().roll.fpsSource).toBe('manual');
  });

  it('ありえない値は受け付けない', () => {
    s().setRollFps(0, 'manual');
    s().setRollFps(Number.NaN, 'manual');
    expect(s().roll.fps).toBe(24);
  });
});
