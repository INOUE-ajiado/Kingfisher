import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { getStorage } from 'firebase-admin/storage';
import { DEFAULT_MIN_AGE_MS, sweepRushVideos } from './sweep';
import {
  ACCESS,
  db,
  loadOpenShare,
  newViewerId,
  normalizeViewerName,
  requireStaff,
  requireString,
  ROOMS,
  SHARES,
  signVideoUrl,
  verifySharePassword,
  VIEWERS,
} from './lib';

/**
 * ラッシュの配信で、動画へ届く経路をサーバー側に集める。
 *
 * ⚠️ 動画のダウンロードトークンを残さないこと (sealRushVideo)。
 * トークンが残っていると、共有を止めても URL を知っている人が見続けられる。
 * この関数群の意味が無くなる。
 */

setGlobalOptions({ region: 'asia-northeast1', maxInstances: 10 });

/** 社外の視聴者が名前と合言葉で入室する (ログイン不要) */
export const joinRushShare = onCall(async (request) => {
  const shareId = requireString(request.data?.shareId, '共有 ID', 64);
  const password = requireString(request.data?.password, 'パスワード', 200);
  const name = normalizeViewerName(request.data?.name);

  const share = await loadOpenShare(shareId);
  const secret = await verifySharePassword(shareId, password);
  const video = await signVideoUrl(secret.videoPath);

  const viewerId = newViewerId();
  await db.collection(SHARES).doc(shareId).collection(VIEWERS).doc(viewerId).set({
    name,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  return {
    viewerId,
    playbackId: secret.playbackId ?? null,
    roomName: share.roomName,
    videoUrl: video.videoUrl,
    expiresAt: video.expiresAt,
  };
});

/** 視聴中に署名が切れる前の差し替え。在席の合図も兼ねる */
export const refreshRushShareVideoUrl = onCall(async (request) => {
  const shareId = requireString(request.data?.shareId, '共有 ID', 64);
  const password = requireString(request.data?.password, 'パスワード', 200);
  const viewerId = requireString(request.data?.viewerId, '視聴者 ID', 64);

  await loadOpenShare(shareId);
  const secret = await verifySharePassword(shareId, password);
  const video = await signVideoUrl(secret.videoPath);

  await db
    .collection(SHARES)
    .doc(shareId)
    .collection(VIEWERS)
    .doc(viewerId)
    .set({ lastSeenAt: Date.now() }, { merge: true });

  return video;
});

/** 社内 (オペレーターと一般画面) が動画を見るための URL。合言葉を知っていることを鍵で示す */
export const getRushRoomVideoUrl = onCall(async (request) => {
  requireStaff(request);
  const roomId = requireString(request.data?.roomId, 'ルーム ID', 64).toUpperCase();
  const accessKey = requireString(request.data?.accessKey, '鍵', 128);

  const snap = await db.collection(ROOMS).doc(roomId).collection(ACCESS).doc(accessKey).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'このルームの合言葉が違います。');

  return await signVideoUrl(snap.data()?.videoPath);
});

/**
 * アップロードした動画を「署名付き URL でしか読めない」状態にする。
 *
 * ⚠️ アップロードの直後に必ず呼ぶこと。Firebase の SDK でアップロードした動画には
 * ダウンロードトークンが付いており、そのままでは期限なしで誰でも読めてしまう。
 */
export const sealRushVideo = onCall(async (request) => {
  requireStaff(request);
  const videoPath = requireString(request.data?.videoPath, '動画のパス', 512);
  if (!videoPath.startsWith('rushVideos/')) {
    throw new HttpsError('invalid-argument', 'ラッシュの動画ではありません');
  }

  const file = getStorage().bucket().file(videoPath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', '動画が見つかりません');

  await file.setMetadata({
    cacheControl: 'private, max-age=3600',
    metadata: { firebaseStorageDownloadTokens: null },
  });

  const [metadata] = await file.getMetadata();
  const sealed = !metadata.metadata?.firebaseStorageDownloadTokens;
  if (!sealed) throw new HttpsError('internal', 'ダウンロードトークンを消せませんでした');
  return { sealed: true };
});

/**
 * どこからも参照されていない動画を、毎日片づける。
 *
 * アップロードは済んだのにルームを作れなかった場合の取りこぼしを拾う
 * (画面側でもその場で消しているが、ブラウザが落ちると消せないため)。
 */
export const sweepRushVideosDaily = onSchedule(
  { schedule: '0 4 * * *', timeZone: 'Asia/Tokyo', region: 'asia-northeast1' },
  async () => {
    const result = await sweepRushVideos(DEFAULT_MIN_AGE_MS);
    console.log('ラッシュ動画の片づけ:', JSON.stringify(result));
  }
);

/** 同じ片づけを手で走らせる (社内のみ)。minAgeMinutes を指定すると、新しいものも対象にできる */
export const sweepRushVideosNow = onCall(async (request) => {
  requireStaff(request);
  const minutes = Number(request.data?.minAgeMinutes);
  const minAgeMs = Number.isFinite(minutes) && minutes >= 0 ? minutes * 60 * 1000 : DEFAULT_MIN_AGE_MS;
  const result = await sweepRushVideos(minAgeMs);
  console.log('ラッシュ動画の片づけ (手動):', JSON.stringify(result));
  return result;
});
