import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';

/**
 * ラッシュの共通処理。
 *
 * ⚠️ 合言葉のハッシュと動画の在りかは、ここ (サーバー) だけが読む。
 * クライアントへ返すのは「期限付きの署名付き URL」だけにすること。
 */

if (getApps().length === 0) initializeApp();

export const db = getFirestore();

export const SHARES = 'rushShares';
export const SHARE_SECRETS = 'rushShareSecrets';
export const SHARE_ATTEMPTS = 'rushShareAttempts';
export const VIEWERS = 'viewers';
export const ROOMS = 'rushRooms';
export const ACCESS = 'access';

/** 署名付き URL の寿命。短くすると取り消しは速くなるが、再生中の差し替えが増える */
export const SIGNED_URL_TTL_MS = 30 * 60 * 1000;

/** 合言葉の試行制限 */
export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const ATTEMPT_LIMIT = 10;

export const MAX_VIEWER_NAME_LENGTH = 40;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 共有の合言葉のハッシュ。クライアントの computeShareAccessKey と同じ作り方 */
export function sharePasswordHash(shareId: string, password: string): string {
  return sha256Hex(`kingfisher-rush-share:${shareId.trim()}:${password}`);
}

/** 長さの違いで中身が漏れないよう、固定長にしてから比べる */
export function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function newViewerId(): string {
  return randomBytes(16).toString('hex');
}

export function requireString(value: unknown, name: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HttpsError('invalid-argument', `${name} が正しくありません`);
  }
  return value.trim();
}

export function normalizeViewerName(name: unknown): string {
  if (typeof name !== 'string') throw new HttpsError('invalid-argument', 'お名前を入力してください');
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > MAX_VIEWER_NAME_LENGTH) {
    throw new HttpsError('invalid-argument', `お名前は ${MAX_VIEWER_NAME_LENGTH} 文字以内で入力してください`);
  }
  return trimmed;
}

/** 呼び出し元が @ajiado.co.jp の社員か (社内向けの関数で使う) */
export function requireStaff(request: CallableRequest): string {
  const token = request.auth?.token as { email?: string; email_verified?: boolean } | undefined;
  const email = (token?.email || '').trim().toLowerCase();
  if (!token?.email_verified || !email.endsWith('@ajiado.co.jp')) {
    throw new HttpsError('permission-denied', '@ajiado.co.jp のアカウントでログインしてください');
  }
  return email;
}

export interface ShareDoc {
  roomId: string;
  roomName: string;
  expiresAt: number;
  revoked: boolean;
}

/** 共有が今も開いているか。閉じていれば理由つきで断る */
export async function loadOpenShare(shareId: string): Promise<ShareDoc> {
  const snap = await db.collection(SHARES).doc(shareId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'この URL の共有は見つかりませんでした。', { reason: 'not-found' });
  }
  const share = snap.data() as ShareDoc;
  if (share.revoked) {
    throw new HttpsError('permission-denied', 'この共有は終了しました。', { reason: 'revoked' });
  }
  if (!(Date.now() < share.expiresAt)) {
    throw new HttpsError('permission-denied', 'この共有は有効期限が切れています。', { reason: 'expired' });
  }
  return share;
}

export interface ShareSecret {
  passwordHash: string;
  videoPath: string | null;
  playbackId: string | null;
}

/**
 * 合言葉を照合する。
 *
 * ⚠️ 照合の前に試行回数を見ること。ここを素通りさせると、URL を持っている人が
 * 何度でも合言葉を試せてしまう (画面側だけで数えても意味がない)。
 */
export async function verifySharePassword(shareId: string, password: string): Promise<ShareSecret> {
  await assertNotTooManyAttempts(shareId);

  const snap = await db.collection(SHARE_SECRETS).doc(shareId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'この共有は開けません。担当者にご連絡ください。', { reason: 'not-found' });
  }
  const secret = snap.data() as ShareSecret;

  if (!hashEquals(secret.passwordHash, sharePasswordHash(shareId, password))) {
    await recordFailedAttempt(shareId);
    // ⚠️ 停止・期限切れと同じ扱いにしないこと。画面ごと閉じてしまい、入れ直せなくなる
    throw new HttpsError('permission-denied', 'パスワードが違います。', { reason: 'wrong-password' });
  }
  await clearAttempts(shareId);
  return secret;
}

async function assertNotTooManyAttempts(shareId: string): Promise<void> {
  const snap = await db.collection(SHARE_ATTEMPTS).doc(shareId).get();
  if (!snap.exists) return;
  const failures: number[] = snap.data()?.failures || [];
  const recent = failures.filter((t) => Date.now() - t < ATTEMPT_WINDOW_MS);
  if (recent.length >= ATTEMPT_LIMIT) {
    const waitMin = Math.ceil((ATTEMPT_WINDOW_MS - (Date.now() - recent[0])) / 60000);
    throw new HttpsError('resource-exhausted', `試行が多すぎます。${waitMin} 分ほど待ってからお試しください。`, {
      reason: 'too-many-attempts',
    });
  }
}

async function recordFailedAttempt(shareId: string): Promise<void> {
  const ref = db.collection(SHARE_ATTEMPTS).doc(shareId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const failures: number[] = snap.exists ? snap.data()?.failures || [] : [];
    const recent = [...failures, Date.now()].filter((t) => Date.now() - t < ATTEMPT_WINDOW_MS).slice(-ATTEMPT_LIMIT);
    tx.set(ref, { failures: recent, updatedAt: Timestamp.now() });
  });
}

async function clearAttempts(shareId: string): Promise<void> {
  await db.collection(SHARE_ATTEMPTS).doc(shareId).delete().catch(() => undefined);
}

export interface SignedVideo {
  videoUrl: string;
  expiresAt: number;
}

/**
 * 動画へ届く、期限付きの URL を作る。
 *
 * ⚠️ 実行するサービスアカウントに自分自身への roles/iam.serviceAccountTokenCreator が要る
 * (鍵ファイルを置かずに署名するため)。無いと「Permission 'iam.serviceAccounts.signBlob' denied」で落ちる。
 */
export async function signVideoUrl(videoPath: string | null | undefined): Promise<SignedVideo> {
  if (!videoPath) throw new HttpsError('not-found', '映像が登録されていません。');
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  const file = getStorage().bucket().file(videoPath);

  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', '映像が見つかりません。担当者にご連絡ください。');

  const [videoUrl] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt });
  return { videoUrl, expiresAt };
}
