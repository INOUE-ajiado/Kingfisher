import { getStorage } from 'firebase-admin/storage';
import { db, SHARE_SECRETS } from './lib';
import { decideSweep } from './sweepRules';

/**
 * どこからも参照されていない動画の片づけ。
 *
 * アップロードは済んだのにルームを作れなかった (通信が切れた・ブラウザを閉じた) とき、
 * 動画だけが Storage に残る。置きっぱなしは保管料になり、消し忘れは流出の元にもなる。
 *
 * ⚠️ 参照を数え落とさないこと。消してはいけない動画を消すと、試写そのものができなくなる。
 * 参照は 2 か所にある:
 *   rushRooms/{ルームID}/access/{鍵}   … 社内から見るときの在りか
 *   rushShareSecrets/{共有ID}          … 社外へ配ったときの在りか
 * ⚠️ 上げた直後のものを消さないこと。ルームを作っている最中はまだ参照が無い。
 */

/** これより新しい動画は、作成中かもしれないので触らない */
export const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  調べた数: number;
  参照されている数: number;
  消した数: number;
  若いので残した数: number;
  トークンを外した数: number;
  消した合計MB: number;
}

/** 今どこかから参照されている動画のパス */
export async function collectReferencedVideoPaths(): Promise<Set<string>> {
  const referenced = new Set<string>();

  const roomAccess = await db.collectionGroup('access').get();
  roomAccess.forEach((doc) => {
    const path = doc.data()?.videoPath;
    if (typeof path === 'string' && path) referenced.add(path);
  });

  const secrets = await db.collection(SHARE_SECRETS).get();
  secrets.forEach((doc) => {
    const path = doc.data()?.videoPath;
    if (typeof path === 'string' && path) referenced.add(path);
  });

  return referenced;
}

/**
 * 参照されていない動画を消す。
 * あわせて、参照されている動画にダウンロードトークンが残っていたら外す
 * (封印に失敗したまま残っていると、署名付き URL の意味が無くなる)。
 */
export async function sweepRushVideos(minAgeMs: number = DEFAULT_MIN_AGE_MS): Promise<SweepResult> {
  const referenced = await collectReferencedVideoPaths();
  const [files] = await getStorage().bucket().getFiles({ prefix: 'rushVideos/' });
  const now = Date.now();

  const result: SweepResult = {
    調べた数: files.length,
    参照されている数: 0,
    消した数: 0,
    若いので残した数: 0,
    トークンを外した数: 0,
    消した合計MB: 0,
  };

  for (const file of files) {
    const decision = decideSweep({
      name: file.name,
      referenced,
      timeCreated: file.metadata.timeCreated as string | undefined,
      now,
      minAgeMs,
    });

    if (decision === 'keep-referenced') {
      result.参照されている数 += 1;
      if (file.metadata.metadata?.firebaseStorageDownloadTokens) {
        await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
        result.トークンを外した数 += 1;
        console.warn('残っていたダウンロードトークンを外しました:', file.name);
      }
      continue;
    }
    if (decision === 'keep-young') {
      result.若いので残した数 += 1;
      continue;
    }

    const bytes = Number(file.metadata.size ?? 0);
    await file.delete();
    result.消した数 += 1;
    result.消した合計MB += bytes / (1024 * 1024);
    console.log('参照されていない動画を消しました:', file.name, Math.round(bytes / 1048576) + 'MB');
  }

  result.消した合計MB = Math.round(result.消した合計MB * 10) / 10;
  return result;
}
