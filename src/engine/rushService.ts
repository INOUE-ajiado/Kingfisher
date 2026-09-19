import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';

/**
 * Firebase Storage に動画ファイルをアップロードし、ダウンロードURLを返す
 */
export async function uploadRushVideoToStorage(
  file: File,
  roomId: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const safeFileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const storageRef = ref(storage, `rushVideos/${roomId}/${Date.now()}_${safeFileName}`);
  const uploadTask = uploadBytesResumable(storageRef, file);

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
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadUrl);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

export interface RushRoomDoc {
  id: string;
  roomName: string;
  hostEmail: string;
  operatorEmails?: string[];
  passwordHash: string;
  videoUrl?: string | null;
  videoName?: string | null;
  createdAt: number;
  lastActiveAt: number;
  isLive: boolean;
  participantCount?: number;
}

const COLLECTION_NAME = 'rushRooms';
const DELETE_LOGS_COLLECTION = 'rushRoomDeleteLogs';

/**
 * 同名のラッシュルームが存在するか確認
 */
export async function checkRoomNameExistsInDB(roomName: string): Promise<boolean> {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('roomName', '==', roomName.trim())
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (err) {
    console.error('Failed to check room name duplicate:', err);
    return false;
  }
}

/**
 * 新規ラッシュルームを Firestore に保存
 */
export async function createRushRoomInDB(room: {
  roomId: string;
  roomName: string;
  hostEmail: string;
  passwordHash: string;
  videoUrl?: string | null;
  videoName?: string | null;
}): Promise<void> {
  try {
    const newDoc: RushRoomDoc = {
      id: room.roomId,
      roomName: room.roomName.trim(),
      hostEmail: room.hostEmail,
      operatorEmails: [room.hostEmail.trim().toLowerCase()],
      passwordHash: room.passwordHash,
      videoUrl: room.videoUrl || null,
      videoName: room.videoName || null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      isLive: true,
      participantCount: 1,
    };

    const roomRef = doc(db, COLLECTION_NAME, room.roomId);
    await setDoc(roomRef, newDoc);

    // 即時ローカルキャッシュにも保存 (リロード耐性)
    const currentCached = getLocalRoomsCache();
    saveLocalRoomsCache([newDoc, ...currentCached.filter((r) => r.id !== newDoc.id)]);
  } catch (err) {
    console.error('Failed to save rush room to Firestore:', err);
  }
}

const LOCAL_CACHE_KEY = 'kingfisher_rush_rooms_cache_v1';

function getLocalRoomsCache(): RushRoomDoc[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveLocalRoomsCache(rooms: RushRoomDoc[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(rooms));
  } catch (e) {
    console.error('Failed to save local rush rooms cache:', e);
  }
}

/**
 * 既存のラッシュルーム一覧をリアルタイム購読
 */
export function subscribeRushRooms(
  _userEmail: string | null | undefined,
  onRoomsUpdate: (rooms: RushRoomDoc[]) => void
): () => void {
  // 1. まずはローカルキャッシュをすぐに返す (リロード直後の消去感を防止)
  const cached = getLocalRoomsCache();
  if (cached.length > 0) {
    onRoomsUpdate(cached);
  }

  try {
    // ⚠️ インデックス未作成エラーを回避するため orderBy なしで単純全取得し、JS側でソート
    const colRef = collection(db, COLLECTION_NAME);
    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const rooms: RushRoomDoc[] = [];
        snapshot.forEach((docSnap) => {
          rooms.push(docSnap.data() as RushRoomDoc);
        });
        // 最終アクティブ時間または作成時間の降順でソート
        rooms.sort((a, b) => (b.lastActiveAt || b.createdAt || 0) - (a.lastActiveAt || a.createdAt || 0));
        saveLocalRoomsCache(rooms);
        onRoomsUpdate(rooms);
      },
      (error) => {
        console.error('Error fetching rush rooms from Firestore:', error);
        // エラー時でもローカルキャッシュがあれば維持する
        const fallback = getLocalRoomsCache();
        if (fallback.length > 0) {
          onRoomsUpdate(fallback);
        }
      }
    );
    return unsubscribe;
  } catch (err) {
    console.error('Failed to subscribe rush rooms:', err);
    return () => {};
  }
}

/**
 * ルームの配信状態や最終アクティブ時間を更新
 */
export async function updateRushRoomStatusInDB(
  roomId: string,
  updates: { isLive?: boolean; videoUrl?: string | null; videoName?: string | null }
): Promise<void> {
  try {
    const roomRef = doc(db, COLLECTION_NAME, roomId);
    await updateDoc(roomRef, {
      ...updates,
      lastActiveAt: Date.now(),
    });
  } catch (err) {
    console.error('Failed to update rush room status:', err);
  }
}

/**
 * ルームのオペレーター権限リストを更新
 */
export async function updateRushRoomOperatorsInDB(
  roomId: string,
  operatorEmails: string[]
): Promise<void> {
  try {
    const roomRef = doc(db, COLLECTION_NAME, roomId);
    await updateDoc(roomRef, {
      operatorEmails,
      lastActiveAt: Date.now(),
    });
  } catch (err) {
    console.error('Failed to update rush room operators:', err);
  }
}

/**
 * ラッシュルームの削除 (理由必須・削除ログ記録)
 */
export async function deleteRushRoomInDB(
  roomId: string,
  roomName: string,
  reason: string,
  deletedByEmail: string
): Promise<void> {
  if (!reason.trim()) {
    throw new Error('削除理由を入力してください');
  }

  try {
    // 1. ルームドキュメントの削除
    const roomRef = doc(db, COLLECTION_NAME, roomId);
    await deleteDoc(roomRef);

    // 2. ローカルキャッシュからも更新・除去
    const currentCached = getLocalRoomsCache();
    saveLocalRoomsCache(currentCached.filter((r) => r.id !== roomId));

    // 3. 削除ログの記録
    const logRef = doc(collection(db, DELETE_LOGS_COLLECTION));
    await setDoc(logRef, {
      roomId,
      roomName,
      reason: reason.trim(),
      deletedByEmail,
      deletedAt: Date.now(),
    });
  } catch (err) {
    console.error('Failed to delete rush room:', err);
    throw err;
  }
}
