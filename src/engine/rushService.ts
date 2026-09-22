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
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { RetakeItem } from './retakeStore';
import {
  computeRoomAccessKey,
  generatePlaybackId,
  guessVideoContentType,
  normalizeEmail,
  normalizeRoomId,
} from './rushAccess';
import { PlaybackState } from './rushPlaybackSync';
import { sealRushVideo } from './rushFunctions';
import { deleteRushShareInDB } from './rushShareService';

/**
 * ラッシュルームのクラウド側。
 *
 * 置き場所:
 *   rushRooms/{roomId}                          ルーム名・作成者・オペレーター・LIVE (社内の誰でも読める)
 *   rushRooms/{roomId}/access/{鍵}              動画の URL・パスとサムネイル (鍵 = ルーム ID + 合言葉のハッシュ)
 *   rushRooms/{roomId}/access/{鍵}/retakes/{id} リテイク指示
 *   rushRooms/{roomId}/access/{鍵}/participants/{id} 今ルームに入っている社内の人
 *   rushVideos/{roomId}/{時刻}_{乱数}_{名前}      動画本体 (Storage)
 *   rushPlayback/{再生ID}                        ホストの再生状態 (視聴者が追従する。ID は乱数)
 *   rushShares/{共有ID}/...                       外部共有 (rushShareService.ts)
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
const PLAYBACK = 'rushPlayback';
const PARTICIPANTS = 'participants';
const SHARES = 'rushShares';

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
  /**
   * Storage 上の動画のパス。
   * ⚠️ 動画の URL をここへ置かないこと。期限のない URL は取り消せない。
   * 再生のたびに Cloud Functions から寿命 30 分の署名付き URL を受け取る。
   */
  videoPath: string | null;
  videoName: string | null;
  /** アップロード時に手元の動画から作ったサムネイル (JPEG の data URL) */
  thumbnails: string[];
  updatedAt: number;
  /** 再生状態の文書 ID (rushPlayback)。古いルームには無いので、オペレーターが開いたときに作る */
  playbackId?: string | null;
  /** このルームから発行した外部共有 */
  shares?: RushShareEntry[];
}

/** ルームの access 文書に控える外部共有。合言葉はここにしか置かない (招待文を作り直すため) */
export interface RushShareEntry {
  shareId: string;
  password: string;
  expiresAt: number;
  createdAt: number;
  createdByEmail: string;
}

export interface UploadedRushVideo {
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
    // ⚠️ これが無いと毎回取り直しになる。タイムラインのコマ切り出しは裏でもう一度
    // 同じ動画を読むので、200MB の動画なら転送量がそのまま倍になる
    cacheControl: 'private, max-age=3600',
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
          // ⚠️ ダウンロード URL を作らないこと。作ると期限のないトークンが動画に付き、
          // 共有を止めても URL を知っている人が見続けられる
          await sealRushVideo(path);
          resolve({ path, name: file.name });
        } catch (err) {
          // 封印できなかった動画は置いておけない (トークン付きのまま残る)
          await deleteRushVideoInStorage(path);
          reject(err);
        }
      }
    );
  });
}

/**
 * 上げた動画を消す。
 * ⚠️ ルームを作れなかったときは必ず呼ぶこと。放っておくと、誰からも参照されない動画が
 * 保管料を食い続ける (取りこぼしは関数側の毎日の片づけが拾う)。
 */
export async function deleteRushVideoInStorage(videoPath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, videoPath));
  } catch (err) {
    console.warn('Failed to delete orphan rush video:', err);
  }
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

  const playbackId = await createRushPlaybackInDB(roomId);
  const accessKey = await computeRoomAccessKey(roomId, room.password);
  const access: RushAccessDoc = {
    videoPath: room.video?.path ?? null,
    videoName: room.video?.name ?? null,
    thumbnails: room.thumbnails,
    updatedAt: now,
    playbackId,
    shares: [],
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

// ─── 参加者 (社内) ───────────────────────────────────────────────────────────

export interface RushParticipantDoc {
  id: string;
  email: string;
  name: string;
  isOperator: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

/** 入室したことを知らせる。以後 heartbeat で在席を伝える */
export async function joinRushParticipantInDB(
  roomId: string,
  accessKey: string,
  participantId: string,
  who: { email: string; name: string; isOperator: boolean }
): Promise<void> {
  const now = Date.now();
  await setDoc(doc(db, ROOMS, roomId, ACCESS, accessKey, PARTICIPANTS, participantId), {
    email: normalizeEmail(who.email),
    name: who.name,
    isOperator: who.isOperator,
    joinedAt: now,
    lastSeenAt: now,
  });
}

export async function heartbeatRushParticipantInDB(
  roomId: string,
  accessKey: string,
  participantId: string,
  isOperator: boolean
): Promise<void> {
  await setDoc(
    doc(db, ROOMS, roomId, ACCESS, accessKey, PARTICIPANTS, participantId),
    { lastSeenAt: Date.now(), isOperator },
    { merge: true }
  );
}

export async function leaveRushParticipantInDB(
  roomId: string,
  accessKey: string,
  participantId: string
): Promise<void> {
  await deleteDoc(doc(db, ROOMS, roomId, ACCESS, accessKey, PARTICIPANTS, participantId));
}

/** 今ルームにいる社内の人 (参加した順) */
export function subscribeRushParticipants(
  roomId: string,
  accessKey: string,
  onUpdate: (participants: RushParticipantDoc[]) => void
): () => void {
  return onSnapshot(
    collection(db, ROOMS, roomId, ACCESS, accessKey, PARTICIPANTS),
    (snapshot) => {
      const list: RushParticipantDoc[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          email: data.email,
          name: data.name,
          isOperator: !!data.isOperator,
          joinedAt: data.joinedAt,
          lastSeenAt: data.lastSeenAt,
        });
      });
      list.sort((a, b) => a.joinedAt - b.joinedAt);
      onUpdate(list);
    },
    (error) => console.error('Error watching rush participants:', error)
  );
}

// ─── 再生状態 (ホスト → 視聴者) ───────────────────────────────────────────────

/** 再生状態の文書を作り、その ID を返す (ルームを作るときと、古いルームを開いたときに使う) */
async function createRushPlaybackInDB(roomId: string): Promise<string> {
  const playbackId = generatePlaybackId();
  await setDoc(doc(db, PLAYBACK, playbackId), {
    roomId: normalizeRoomId(roomId),
    playing: false,
    position: 0,
    live: false,
    updatedAt: serverTimestamp(),
  });
  return playbackId;
}

/** 古いルーム (再生状態の文書が無い) を開いたオペレーターが、後から作って access 文書に結びつける */
export async function attachRushPlaybackInDB(roomId: string, accessKey: string): Promise<string> {
  const playbackId = await createRushPlaybackInDB(roomId);
  await updateDoc(doc(db, ROOMS, roomId, ACCESS, accessKey), { playbackId, updatedAt: Date.now() });
  return playbackId;
}

export async function writeRushPlaybackInDB(playbackId: string, state: PlaybackState): Promise<void> {
  await updateDoc(doc(db, PLAYBACK, playbackId), {
    playing: state.playing,
    position: state.position,
    live: state.live,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 再生状態を購読する。受け取った瞬間の手元の時刻も渡す (位置の補間に使う)。
 * 自分が書いた直後の手元の反映 (hasPendingWrites) は、ホスト自身の画面なので無視してよい。
 */
export function subscribeRushPlayback(
  playbackId: string,
  onUpdate: (state: PlaybackState, receivedAt: number) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    doc(db, PLAYBACK, playbackId),
    (snap) => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const d = snap.data();
      onUpdate({ playing: !!d.playing, position: Number(d.position) || 0, live: !!d.live }, Date.now());
    },
    (error) => {
      console.error('Error watching rush playback:', error);
      onError?.(error);
    }
  );
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

  // 0. 外部共有を止めて消す (ルームが消えたあとも URL から入れてしまわないように)。
  //    規則が「このルームのオペレーターか」をルームの文書で見るので、ルームより先に消す
  for (const share of access.shares || []) {
    try {
      await updateDoc(doc(db, SHARES, share.shareId), { revoked: true });
      await deleteRushShareInDB(share.shareId);
    } catch (err) {
      console.warn('Failed to delete rush share:', err);
    }
  }

  // 0b. 再生状態の文書
  if (access.playbackId) {
    try {
      await deleteDoc(doc(db, PLAYBACK, access.playbackId));
    } catch (err) {
      console.warn('Failed to delete rush playback:', err);
    }
  }

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
