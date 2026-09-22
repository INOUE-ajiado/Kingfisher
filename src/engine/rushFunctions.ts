import { getFunctions, httpsCallable, FunctionsError } from 'firebase/functions';
import { app } from './firebase';

/**
 * Cloud Functions (asia-northeast1) の呼び出し。
 *
 * 動画へ届く URL は、必ずここを通して受け取る。
 * ⚠️ 期限付きの URL なので、控えて使い回さないこと (expiresAt を見て取り直す)。
 */

const functions = getFunctions(app, 'asia-northeast1');

export interface SignedVideo {
  videoUrl: string;
  /** この時刻を過ぎると URL は使えない (ミリ秒) */
  expiresAt: number;
}

export interface JoinShareResult extends SignedVideo {
  viewerId: string;
  playbackId: string | null;
  roomName: string;
}

/** 関数から返る失敗を、画面に出せる言葉へ直す */
export function describeFunctionError(err: unknown): string {
  const e = err as FunctionsError;
  if (e?.message) {
    // HttpsError のメッセージはこちらで日本語にしてある
    if (e.code === 'functions/unavailable' || e.code === 'functions/internal') {
      return '配信サーバーに接続できません。時間をおいてお試しください。';
    }
    return e.message;
  }
  return '通信に失敗しました。時間をおいてお試しください。';
}

/**
 * 社外の視聴者が名前と合言葉で入室する。
 * viewerId を渡すと、その札を使い回す (開き直しても一覧に増えない)。
 */
export async function joinRushShare(
  shareId: string,
  password: string,
  name: string,
  viewerId?: string
): Promise<JoinShareResult> {
  const call = httpsCallable<
    { shareId: string; password: string; name: string; viewerId?: string },
    JoinShareResult
  >(functions, 'joinRushShare');
  return (await call({ shareId, password, name, viewerId })).data;
}

/** 視聴中に署名が切れる前の取り直し (在席の合図も兼ねる) */
export async function refreshRushShareVideoUrl(
  shareId: string,
  password: string,
  viewerId: string
): Promise<SignedVideo> {
  const call = httpsCallable<{ shareId: string; password: string; viewerId: string }, SignedVideo>(
    functions,
    'refreshRushShareVideoUrl'
  );
  return (await call({ shareId, password, viewerId })).data;
}

/** 社内の再生 (オペレーター・一般画面) 用 */
export async function getRushRoomVideoUrl(roomId: string, accessKey: string): Promise<SignedVideo> {
  const call = httpsCallable<{ roomId: string; accessKey: string }, SignedVideo>(functions, 'getRushRoomVideoUrl');
  return (await call({ roomId, accessKey })).data;
}

/** アップロードした動画を、署名付き URL でしか読めない状態にする */
export async function sealRushVideo(videoPath: string): Promise<void> {
  const call = httpsCallable<{ videoPath: string }, { sealed: boolean }>(functions, 'sealRushVideo');
  await call({ videoPath });
}
