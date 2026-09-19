import { describe, it, expect, beforeEach } from 'vitest';
import { usePaintStore } from './usePaintStore';
import { initialRushState } from './slices/rushSlice';

/**
 * ラッシュのスライスが他のスライスの状態を壊さないこと。
 *
 * 以前はラッシュ側が isAuthenticated という同じ名前を持っていたため、
 * 退室 (leaveRushRoom) で Google ログインの状態まで false に戻り、
 * ログイン済みなのに AuthGuard が全面を塞いでいた。
 */

const s = () => usePaintStore.getState();

const room = {
  roomId: 'RUSH-AAAAAA',
  isHost: true,
  roomName: '第03話',
  password: 'secret',
  accessKey: 'k'.repeat(64),
  videoUrl: 'https://example.com/a.mp4',
  videoName: 'a.mp4',
  thumbnails: ['data:image/jpeg;base64,AAAA'],
  isLive: true,
};

beforeEach(() => {
  usePaintStore.setState({
    ...initialRushState,
    isAuthenticated: true,
    paneLayout: { slots: [], maximized: null },
  });
});

describe('rushSlice とログイン状態', () => {
  it('ルームに入っても出ても Google ログインの状態は変わらない', () => {
    s().setRushRoom(room);
    expect(s().isAuthenticated).toBe(true);

    s().leaveRushRoom();
    expect(s().isAuthenticated).toBe(true);
  });

  it('未ログインのままルームに入っても、ログイン済みにはならない (読み取り専用の解除に使われているため)', () => {
    usePaintStore.setState({ isAuthenticated: false });
    s().setRushRoom(room);
    expect(s().isAuthenticated).toBe(false);
  });
});

describe('ルームの切り替え', () => {
  it('別のルームへ入り直すと、前のルームの動画・リテイク・録画は残らない', () => {
    s().setRushRoom(room);
    s().updateRushRetakes([{ id: 'r1', timecode: '00:00:01+00', frame: 24, tag: '撮影', text: 'x' }]);
    s().addRushArchive({ id: 'a1', title: 't', videoUrl: room.videoUrl, duration: 1, createdAt: 0, retakeItems: [] });

    s().setRushRoom({ ...room, roomId: 'RUSH-BBBBBB', videoUrl: null, videoName: null, thumbnails: [], isLive: false });
    expect(s().roomId).toBe('RUSH-BBBBBB');
    expect(s().videoUrl).toBeNull();
    expect(s().rushThumbnails).toEqual([]);
    expect(s().retakeItems).toEqual([]);
    expect(s().archives).toEqual([]);
    expect(s().isLive).toBe(false);
  });

  it('退室すると一面表示が解け、合言葉と鍵は手元から消える', () => {
    s().setRushRoom(room);
    expect(s().paneLayout.maximized).toBe('rush');

    s().leaveRushRoom();
    expect(s().paneLayout.maximized).toBeNull();
    expect(s().roomPassword).toBe('');
    expect(s().rushAccessKey).toBeNull();
    expect(s().isRushOpen).toBe(false);
  });
});
