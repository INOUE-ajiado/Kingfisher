import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { RetakeItem } from './retakeStore';
import {
  computeRoomAccessKey,
  guessVideoContentType,
  normalizeEmail,
  normalizeRoomId,
} from './rushAccess';

/**
 * ラッシュルームのクラウド側。
 *
 * 置き場所:
 *   rushRooms/{roomId}                          ルーム名・作成者・オペレーター・LIVE (社内の誰でも読める)
 *   rushRooms/{roomId}/access/{鍵}              動画の URL・パスとサムネイル (鍵 = ルーム ID + 合言葉のハッシュ)
 *   rushRooms/{roomId}/access/{鍵}/retakes/{id} リテイク指示
 *   rushVideos/{roomId}/{時刻}_{乱数}_{名前}      動画本体 (Storage)
 *
 * ⚠️ 動画のパスや URL をルームの文書へ置かないこと。ルームの文書は社内の誰でも読めるので、
 * 置いた時点で合言葉を知らなくても動画を取り出せてしまう。
 *
 * ⚠️ 失敗を握りつぶさないこと。以前は例外を console に出すだけで返していたため、
 * Firestore が使えない状態でも「作成できた」ように画面が進み、
 * 他の人からは見えないルームが手元にだけ残っていた。
 */

const ROOMS = 'rushRooms';
const ACCESS = 'access';
const RETAKES = 'retakes';
const DELETE_LOGS = 'rushRoomDeleteLogs';

/** 以前 localStorage に置いていたルーム一覧の控え (合言葉が平文で入っていた) */
const LEGACY_LOCAL_CACHE_KEY = 'kingfisher_rush_rooms_cache_v1';

export interface RushRoomDoc {
  id: string;
  roomName: string;
  hostEmail: string;
  operatorEmails: string[];
  createdAt: number;
  lastActiveAt: number;
  isLive: boolean;
}

export interface RushAccessDoc {
  videoUrl: string | null;
  /** Storage 上の動画のパス。ルームを消すときに動画も消すために使う */
  videoPath: string | null;
  videoName: string | null;
  /** アップロード時に手元の動画から作ったサムネイル (JPEG の data URL) */
  thumbnails: string[];
  updatedAt: number;
}

export interface UploadedRushVideo {
  url: string;
  path: string;
  name: string;
}

export class RushJoinError extends Error {
  constructor(public readonly reason: 'not-found' | 'wrong-password', message: string) {
    super(message);
    this.name = 'RushJoinError';
  }
}

/** 旧版が残した localStorage の控えを消す。合言葉が平文で入っているため */
export function clearLegacyRushCache(): void {
  try {
    localStorage.removeItem(LEGACY_LOCAL_CACHE_KEY);
  } catch {
    // localStorage が使えない環境では何もしない
  }
}

/**
 * Firebase Storage に動画ファイルをアップロードし、ダウンロード URL と保存先を返す
 */
export async function uploadRushVideoToStorage(
  file: File,
  roomId: string,
  onProgress?: (pct: number) => void
): Promise<UploadedRushVideo> {
  const safeFileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  // 一覧は規則で禁じているが、名前から当てられないよう乱数も混ぜる
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const path = `rushVideos/${roomId}/${Date.now()}_${nonce}_${safeFileName}`;
  const storageRef = ref(storage, path);
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: guessVideoContentType(file.name, file.type),
  });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        if (onProgress) onProgress(pct);
      },
      (error) => {
        console.error('Video upload to Firebase Storage failed:', error);
        reject(error);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({ url, path, name: file.name });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/**
 * 同名のラッシュルームが存在するか確認
 */
export async function checkRoomNameExistsInDB(roomName: string): Promise<boolean> {
  const q = query(collection(db, ROOMS), where('roomName', '==', roomName.trim()));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * 新規ラッシュルームを Firestore に保存し、access 文書の鍵を返す
 */
export async function createRushRoomInDB(room: {
  roomId: string;
  roomName: string;
  hostEmail: string;
  password: string;
  video: UploadedRushVideo | null;
  thumbnails: string[];
}): Promise<string> {
  const roomId = normalizeRoomId(room.roomId);
  const hostEmail = normalizeEmail(room.hostEmail);
  const now = Date.now();

  const newDoc: RushRoomDoc = {
    id: roomId,
    roomName: room.roomName.trim(),
    hostEmail,
    operatorEmails: [hostEmail],
    createdAt: now,
    lastActiveAt: now,
    isLive: false,
  };
  // 規則が「作成者のルームか」を読むので、ルームの文書を先に作る
  await setDoc(doc(db, ROOMS, roomId), newDoc);

  const accessKey = await computeRoomAccessKey(roomId, room.password);
  const access: RushAccessDoc = {
    videoUrl: room.video?.url ?? null,
    videoPath: room.video?.path ?? null,
    videoName: room.video?.name ?? null,
    thumbnails: room.thumbnails,
    updatedAt: now,
  };
  await setDoc(doc(db, ROOMS, roomId, ACCESS, accessKey), access);

  return accessKey;
}

/**
 * ルーム ID と合言葉を照合する。通れば、ルームと動画の在りかを返す。
 */
export async function verifyRushRoomAccess(
  roomIdInput: string,
  password: string
): Promise<{ room: RushRoomDoc; access: RushAccessDoc; accessKey: string }> {
  const roomId = normalizeRoomId(roomIdInput);
  const roomSnap = await getDoc(doc(db, ROOMS, roomId));
  if (!roomSnap.exists()) {
    throw new RushJoinError('not-found', `ルーム「${roomId}」は見つかりませんでした。ID を確かめてください。`);
  }

  const accessKey = await computeRoomAccessKey(roomId, password);
  const accessSnap = await getDoc(doc(db, ROOMS, roomId, ACCESS, accessKey));
  if (!accessSnap.exists()) {
    throw new RushJoinError('wrong-password', 'パスワードが違います。');
  }

  return {
    room: roomSnap.data() as RushRoomDoc,
    access: accessSnap.data() as RushAccessDoc,
    accessKey,
  };
}

/**
 * 既存のラッシュルーム一覧をリアルタイム購読
 */
export function subscribeRushRooms(
  onRoomsUpdate: (rooms: RushRoomDoc[]) => void,
  onError: (error: Error) => void
): () => void {
  // ⚠️ インデックス未作成エラーを回避するため orderBy なしで単純全取得し、JS側でソート
  return onSnapshot(
    collection(db, ROOMS),
    (snapshot) => {
      const rooms: RushRoomDoc[] = [];
      snapshot.forEach((docSnap) => {
        rooms.push(docSnap.data() as RushRoomDoc);
      });
      // 最終アクティブ時間または作成時間の降順でソート
      rooms.sort((a, b) => (b.lastActiveAt || b.createdAt || 0) - (a.lastActiveAt || a.createdAt || 0));
      onRoomsUpdate(rooms);
    },
    (error) => {
      console.error('Error fetching rush rooms from Firestore:', error);
      onError(error);
    }
  );
}

/** 1 つのルームの文書 (LIVE・オペレーター) を購読する。消されたら null を渡す */
export function subscribeRushRoom(
  roomId: string,
  onUpdate: (room: RushRoomDoc | null) => void
): () => void {
  return onSnapshot(
    doc(db, ROOMS, roomId),
    (snap) => {
      // 手元のキャッシュだけで「無い」と言っている段階では、消されたと判断しない
      if (!snap.exists() && snap.metadata.fromCache) return;
      onUpdate(snap.exists() ? (snap.data() as RushRoomDoc) : null);
    },
    (error) => console.error('Error watching rush room:', error)
  );
}

/** 動画の在りか (access 文書) を購読する */
export function subscribeRushAccess(
  roomId: string,
  accessKey: string,
  onUpdate: (access: RushAccessDoc | null) => void
): () => void {
  return onSnapshot(
    doc(db, ROOMS, roomId, ACCESS, accessKey),
    (snap) => onUpdate(snap.exists() ? (snap.data() as RushAccessDoc) : null),
    (error) => console.error('Error watching rush access:', error)
  );
}

/** リテイク指示を購読する (コマ順) */
export function subscribeRushRetakes(
  roomId: string,
  accessKey: string,
  onUpdate: (items: RetakeItem[]) => void
): () => void {
  return onSnapshot(
    collection(db, ROOMS, roomId, ACCESS, accessKey, RETAKES),
    (snapshot) => {
      const items: RetakeItem[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({ id: docSnap.id, timecode: d.timecode, frame: d.frame, tag: d.tag, text: d.text });
      });
      items.sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
      onUpdate(items);
    },
    (error) => console.error('Error watching rush retakes:', error)
  );
}

export async function addRushRetakeInDB(
  roomId: string,
  accessKey: string,
  item: RetakeItem,
  authorEmail: string
): Promise<void> {
  await setDoc(doc(db, ROOMS, roomId, ACCESS, accessKey, RETAKES, item.id), {
    timecode: item.timecode,
    frame: item.frame,
    tag: item.tag,
    text: item.text,
    authorEmail: normalizeEmail(authorEmail),
    createdAt: Date.now(),
  });
}

export async function deleteRushRetakeInDB(roomId: string, accessKey: string, itemId: string): Promise<void> {
  await deleteDoc(doc(db, ROOMS, roomId, ACCESS, accessKey, RETAKES, itemId));
}

/**
 * ルームの配信状態と最終アクティブ時間を更新
 */
export async function updateRushRoomStatusInDB(roomId: string, updates: { isLive: boolean }): Promise<void> {
  await updateDoc(doc(db, ROOMS, roomId), {
    ...updates,
    lastActiveAt: Date.now(),
  });
}

/**
 * ルームのオペレーター権限リストを更新
 */
export async function updateRushRoomOperatorsInDB(roomId: string, operatorEmails: string[]): Promise<void> {
  await updateDoc(doc(db, ROOMS, roomId), {
    operatorEmails: operatorEmails.map(normalizeEmail),
    lastActiveAt: Date.now(),
  });
}

/**
 * ラッシュルームの削除 (理由必須・削除ログ記録)。
 *
 * 作成者とオペレーターだけが消せる (規則で強制)。動画とリテイクは合言葉の鍵の下にあるので、
 * 合言葉も確かめてから、動画 → リテイク → access → ルームの順に消す。
 * ルームを最後に消すのは、規則が「このルームのオペレーターか」をルームの文書で判定するため。
 */
export async function deleteRushRoomInDB(
  room: RushRoomDoc,
  password: string,
  reason: string,
  deletedByEmail: string
): Promise<void> {
  if (!reason.trim()) {
    throw new Error('削除理由を入力してください');
  }

  const { access, accessKey } = await verifyRushRoomAccess(room.id, password);

  // 1. 動画本体。消せなくてもルームの削除は続ける (既に無いなど)
  if (access.videoPath) {
    try {
      await deleteObject(ref(storage, access.videoPath));
    } catch (err) {
      console.warn('Failed to delete rush video from Storage:', err);
    }
  }

  // 2. リテイク指示と access 文書
  const retakes = await getDocs(collection(db, ROOMS, room.id, ACCESS, accessKey, RETAKES));
  await Promise.all(retakes.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, ROOMS, room.id, ACCESS, accessKey));

  // 3. ルームドキュメントの削除
  await deleteDoc(doc(db, ROOMS, room.id));

  // 4. 削除ログの記録
  await setDoc(doc(collection(db, DELETE_LOGS)), {
    roomId: room.id,
    roomName: room.roomName,
    reason: reason.trim(),
    deletedByEmail: normalizeEmail(deletedByEmail),
    deletedAt: Date.now(),
  });
}
