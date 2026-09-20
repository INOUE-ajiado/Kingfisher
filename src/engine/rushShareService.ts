import { arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  computeShareAccessKey,
  generateShareId,
  MAX_SHARE_EXPIRY_MS,
  normalizeEmail,
  normalizeRoomId,
} from './rushAccess';
// 型だけの読み込み (rushService からもこの file を読むため、実体の循環を作らない)
import type { RushShareEntry } from './rushService';

/**
 * 外部共有 (社外の人がログインなしで視聴する URL)。
 *
 * 置き場所:
 *   rushShares/{共有ID}                    ルーム名・期限・無効化 (URL を知っていれば読める)
 *   rushShareSecrets/{共有ID}              合言葉のハッシュと動画の在りか (クライアントからは読めない。関数だけが読む)
 *   rushShares/{共有ID}/viewers/{視聴者ID}  視聴者の名前と最後の合図 (登録は関数。一覧はオペレーターだけ)
 *
 * ⚠️ 外部用パスワードはルームの合言葉とは別にする。社内のルームの合言葉を社外へ渡さないため。
 * ⚠️ 共有の見出し (rushShares/{共有ID}) は URL さえ知っていれば誰でも読める。
 * 入力画面に出すもの (作品名・期限) 以外を置かないこと。発行した人のメールアドレスは
 * 合言葉の内側 (access 文書) に置く。
 * ⚠️ 期限切れ・無効化は規則でも止める。動画そのものへは署名付き URL (寿命 30 分) でしか届かないので、
 * 控えられた URL も最長 30 分で使えなくなる (Doc/Kingfisher_Rush_SignedUrl_Specification.md)。
 */

const ROOMS = 'rushRooms';
const ACCESS = 'access';
const SHARES = 'rushShares';
const SHARE_SECRETS = 'rushShareSecrets';
const VIEWERS = 'viewers';

export interface RushShareDoc {
  id: string;
  roomId: string;
  roomName: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}

/** サーバー (Cloud Functions) だけが読む文書。ここに合言葉のハッシュと動画の在りかを置く */
export interface RushShareSecretDoc {
  roomId: string;
  passwordHash: string;
  videoPath: string | null;
  playbackId: string | null;
  createdByEmail: string;
  createdAt: number;
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
  videoPath: string | null;
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
    createdAt: now,
    expiresAt,
    revoked: false,
  };
  await setDoc(doc(db, SHARES, shareId), share);

  const secret: RushShareSecretDoc = {
    roomId,
    // ⚠️ ハッシュだけを置く。合言葉そのものはクラウドへ送らない
    passwordHash: await computeShareAccessKey(shareId, params.password),
    videoPath: params.videoPath,
    playbackId: params.playbackId,
    createdByEmail,
    createdAt: now,
  };

  const entry: RushShareEntry = {
    shareId,
    accessKey: '',
    password: params.password,
    expiresAt,
    createdAt: now,
    createdByEmail,
  };

  try {
    await setDoc(doc(db, SHARE_SECRETS, shareId), secret);
    // ⚠️ ルームの控えまで書けて初めて「発行できた」。ここで失敗したまま放っておくと、
    // URL は生きているのに一覧に出ず、画面から停止できない共有が残る
    await updateDoc(doc(db, ROOMS, roomId, ACCESS, params.roomAccessKey), {
      shares: arrayUnion(entry),
      updatedAt: now,
    });
  } catch (err) {
    await discardRushShare(shareId);
    throw err;
  }
  return entry;
}

/** 作りかけの共有を取り消す (止めたうえで、書けたものは消す) */
async function discardRushShare(shareId: string): Promise<void> {
  try {
    await updateDoc(doc(db, SHARES, shareId), { revoked: true });
  } catch (err) {
    console.warn('Failed to revoke half-created rush share:', err);
  }
  try {
    await deleteDoc(doc(db, SHARE_SECRETS, shareId));
    await deleteDoc(doc(db, SHARES, shareId));
  } catch (err) {
    console.warn('Failed to delete half-created rush share:', err);
  }
}

/** 共有と、その下の視聴者の記録まで消す (ルームを削除するとき) */
export async function deleteRushShareInDB(shareId: string): Promise<void> {
  const viewers = await getDocs(collection(db, SHARES, shareId, VIEWERS));
  await Promise.all(viewers.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, SHARE_SECRETS, shareId));
  await deleteDoc(doc(db, SHARES, shareId));
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

/** 在席の合図。名乗るのは関数 (joinRushShare) の仕事 */
export async function heartbeatRushShareViewer(shareId: string, viewerId: string): Promise<void> {
  await updateDoc(doc(db, SHARES, shareId, VIEWERS, viewerId), { lastSeenAt: Date.now() });
}

/** 視聴者の一覧 (オペレーター用)。参加順 */
export function subscribeRushShareViewers(
  shareId: string,
  onUpdate: (viewers: RushShareViewer[]) => void
): () => void {
  return onSnapshot(
    collection(db, SHARES, shareId, VIEWERS),
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
