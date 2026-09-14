/**
 * ProRes 変換済み動画 Blob を IndexedDB に保存・取得するキャッシュモジュール。
 * リロード後や後日同じファイルを開いた場合でも待ち時間 0 秒で即時再生可能にする。
 */

import { logDebug } from './debugLog';

const DB_NAME = 'kingfisher_prores_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'converted_blobs';

export interface CachedVideoEntry {
  cacheKey: string;
  blob: Blob;
  mimeType: string;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * キャッシュキーの生成 (ファイル名 + サイズ + 最終更新日)
 */
export function getProResCacheKey(file: File): string {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

/**
 * IndexedDB から変換済み Blob を取得
 */
export async function getCachedProResVideo(cacheKey: string): Promise<{ blob: Blob; objectUrl: string } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => {
        const result = req.result as CachedVideoEntry | undefined;
        // 破損・不完全キャッシュ (10KB 未満) は無効化して削除
        if (result && result.blob && result.blob.size >= 10000) {
          const objectUrl = URL.createObjectURL(result.blob);
          logDebug('roll', `IndexedDB 永続キャッシュから即時復元: ${cacheKey} (${(result.blob.size / 1024).toFixed(1)} KB)`);
          resolve({ blob: result.blob, objectUrl });
        } else {
          if (result) void removeCachedProResVideo(cacheKey);
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('IndexedDB read error:', err);
    return null;
  }
}

/**
 * IndexedDB から特定キーのキャッシュを削除
 */
export async function removeCachedProResVideo(cacheKey: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(cacheKey);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (err) {
    console.warn('IndexedDB delete error:', err);
  }
}

/**
 * IndexedDB へ変換済み Blob を保存
 */
export async function saveCachedProResVideo(cacheKey: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: CachedVideoEntry = {
        cacheKey,
        blob,
        mimeType: blob.type,
        timestamp: Date.now(),
      };
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB write error:', err);
  }
}

/**
 * キャッシュの全削除 (クリア用)
 */
export async function clearProResCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('IndexedDB clear error:', err);
  }
}
