import { arrayUnion, collection, doc, getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  computeShareAccessKey,
  generateShareId,
  MAX_SHARE_EXPIRY_MS,
  normalizeEmail,
  normalizeRoomId,
  shareStatus,
} from './rushAccess';
import { RushShareEntry } from './rushService';

/**
 * 外部共有 (社外の人がログインなしで視聴する URL)。
 *
 * 置き場所:
 *   rushShares/{共有ID}                                  ルーム名・期限・無効化 (URL を知っていれば読める)
 *   rushShares/{共有ID}/access/{鍵}                      動画の URL と再生状態の ID (鍵 = 共有ID + 外部用パスワード)
 *   rushShares/{共有ID}/access/{鍵}/viewers/{視聴者ID}    視聴者の名前と最後の合図 (オペレーターだけが一覧できる)
 *
 * ⚠️ 外部用パスワードはルームの合言葉とは別にする。社内のルームの合言葉を社外へ渡さないため。
 * ⚠️ 期限切れ・無効化は規則でも止める (access 文書と視聴者の登録)。
 * ただし一度受け取った動画の URL までは取り消せない (Storage のダウンロード URL は期限を持たない)。
 */

const ROOMS = 'rushRooms';
const ACCESS = 'access';
const SHARES = 'rushShares';
const VIEWERS = 'viewers';

export interface RushShareDoc {
  id: string;
  roomId: string;
  roomName: string;
  createdByEmail: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}

export interface RushShareAccessDoc {
  videoUrl: string | null;
  videoName: string | null;
  playbackId: string | null;
  updatedAt: number;
}

export interface RushShareViewer {
  id: string;
  name: string;
  joinedAt: number;
  lastSeenAt: number;
}

export class RushShareError extends Error {
  constructor(
    public readonly reason: 'not-found' | 'revoked' | 'expired' | 'wrong-password',
    message: string
  ) {
    super(message);
    this.name = 'RushShareError';
  }
}

/**
 * 外部共有を発行する。発行したものはルームの access 文書にも控える (一覧・招待文の作り直し用)。
 */
export async function createRushShareInDB(params: {
  roomId: string;
  roomName: string;
  roomAccessKey: string;
  videoUrl: string | null;
  videoName: string | null;
  playbackId: string;
  password: string;
  expiresInMs: number;
  createdByEmail: string;
}): Promise<RushShareEntry> {
  const shareId = generateShareId();
  const roomId = normalizeRoomId(params.roomId);
  const now = Date.now();
  const expiresAt = now + Math.min(Math.max(params.expiresInMs, 60 * 1000), MAX_SHARE_EXPIRY_MS - 60 * 1000);
  const createdByEmail = normalizeEmail(params.createdByEmail);

  const share: RushShareDoc = {
    id: shareId,
    roomId,
    roomName: params.roomName,
    createdByEmail,
    createdAt: now,
    expiresAt,
    revoked: false,
  };
  await setDoc(doc(db, SHARES, shareId), share);

  const accessKey = await computeShareAccessKey(shareId, params.password);
  const access: RushShareAccessDoc = {
    videoUrl: params.videoUrl,
    videoName: params.videoName,
    playbackId: params.playbackId,
    updatedAt: now,
  };
  await setDoc(doc(db, SHARES, shareId, ACCESS, accessKey), access);

  const entry: RushShareEntry = {
    shareId,
    accessKey,
    password: params.password,
    expiresAt,
    createdAt: now,
    createdByEmail,
  };
  await updateDoc(doc(db, ROOMS, roomId, ACCESS, params.roomAccessKey), {
    shares: arrayUnion(entry),
    updatedAt: now,
  });
  return entry;
}

/** 外部共有を止める。URL を開いている人の画面も、共有の文書の変化を見て止まる */
export async function revokeRushShareInDB(shareId: string): Promise<void> {
  await updateDoc(doc(db, SHARES, shareId), { revoked: true });
}

/** 止めた・期限の切れた共有を、ルームの控えから取り除く */
export async function removeRushShareEntriesInDB(
  roomId: string,
  roomAccessKey: string,
  remaining: RushShareEntry[]
): Promise<void> {
  await updateDoc(doc(db, ROOMS, normalizeRoomId(roomId), ACCESS, roomAccessKey), {
    shares: remaining,
    updatedAt: Date.now(),
  });
}

export function subscribeRushShare(
  shareId: string,
  onUpdate: (share: RushShareDoc | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    doc(db, SHARES, shareId),
    (snap) => {
      if (!snap.exists() && snap.metadata.fromCache) return;
      onUpdate(snap.exists() ? (snap.data() as RushShareDoc) : null);
    },
    (error) => {
      console.error('Error watching rush share:', error);
      onError?.(error);
    }
  );
}

/** 共有 ID だけで読める範囲 (ルーム名・期限)。入力画面の見出しに使う */
export async function fetchRushShare(shareId: string): Promise<RushShareDoc | null> {
  const snap = await getDoc(doc(db, SHARES, shareId));
  return snap.exists() ? (snap.data() as RushShareDoc) : null;
}

/** 外部用パスワードを照合する。通れば動画の在りかを返す */
export async function verifyRushShareAccess(
  shareId: string,
  password: string
): Promise<{ share: RushShareDoc; access: RushShareAccessDoc; accessKey: string }> {
  const share = await fetchRushShare(shareId);
  if (!share) throw new RushShareError('not-found', 'この URL の共有は見つかりませんでした。');
  const status = shareStatus(share, Date.now());
  if (status === 'revoked') throw new RushShareError('revoked', 'この共有は終了しました。');
  if (status === 'expired') throw new RushShareError('expired', 'この共有は有効期限が切れています。');

  const accessKey = await computeShareAccessKey(shareId, password);
  const snap = await getDoc(doc(db, SHARES, shareId, ACCESS, accessKey));
  if (!snap.exists()) throw new RushShareError('wrong-password', 'パスワードが違います。');
  return { share, access: snap.data() as RushShareAccessDoc, accessKey };
}

/** 視聴者として名乗る。以後 heartbeat で在席を知らせる */
export async function registerRushShareViewer(
  shareId: string,
  accessKey: string,
  viewerId: string,
  name: string
): Promise<void> {
  const now = Date.now();
  await setDoc(doc(db, SHARES, shareId, ACCESS, accessKey, VIEWERS, viewerId), {
    name,
    joinedAt: now,
    lastSeenAt: now,
  });
}

export async function heartbeatRushShareViewer(shareId: string, accessKey: string, viewerId: string): Promise<void> {
  await updateDoc(doc(db, SHARES, shareId, ACCESS, accessKey, VIEWERS, viewerId), { lastSeenAt: Date.now() });
}

/** 視聴者の一覧 (オペレーター用)。参加順 */
export function subscribeRushShareViewers(
  shareId: string,
  accessKey: string,
  onUpdate: (viewers: RushShareViewer[]) => void
): () => void {
  return onSnapshot(
    collection(db, SHARES, shareId, ACCESS, accessKey, VIEWERS),
    (snapshot) => {
      const viewers: RushShareViewer[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        viewers.push({ id: d.id, name: data.name, joinedAt: data.joinedAt, lastSeenAt: data.lastSeenAt });
      });
      viewers.sort((a, b) => a.joinedAt - b.joinedAt);
      onUpdate(viewers);
    },
    (error) => console.error('Error watching rush share viewers:', error)
  );
}
