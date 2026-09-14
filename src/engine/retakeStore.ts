/**
 * .kf 独自拡張子ファイルおよびリテイクメモデータの管理モジュール。
 * 映像ごとの修正指示（タイムコード・コマ番号・タグ・テキスト）を保持・保存・復元する。
 */

import { logDebug } from './debugLog';

export interface RetakeItem {
  id: string;
  timecode: string;
  frame: number;
  tag: string;
  text: string;
}

export interface KfFileFormat {
  version: string;
  app: string;
  videoName: string;
  fps: number;
  updatedAt: string;
  items: RetakeItem[];
}

const DB_NAME = 'kingfisher_retake_notes_db';
const DB_VERSION = 1;
const STORE_NAME = 'retake_notes';

function openRetakeDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'videoKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 映像ごとのキー生成
 */
export function getRetakeKey(videoName: string): string {
  return `retake_${videoName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/**
 * IndexedDB からリテイクメモを自動読み出し
 */
export async function getAutoSavedRetakes(videoName: string): Promise<RetakeItem[]> {
  try {
    const db = await openRetakeDB();
    const key = getRetakeKey(videoName);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const result = req.result as { videoKey: string; items: RetakeItem[] } | undefined;
        resolve(result ? result.items : []);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('Retake DB read error:', err);
    return [];
  }
}

/**
 * IndexedDB へリテイクメモを自動バックアップ
 */
export async function saveAutoRetakes(videoName: string, items: RetakeItem[]): Promise<void> {
  try {
    const db = await openRetakeDB();
    const key = getRetakeKey(videoName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ videoKey: key, videoName, items, updatedAt: new Date().toISOString() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Retake DB write error:', err);
  }
}

/**
 * .kf 形式の文字列 (JSON) を構築
 */
export function buildKfFileContent(videoName: string, fps: number, items: RetakeItem[]): string {
  const data: KfFileFormat = {
    version: '1.0',
    app: 'Kingfisher',
    videoName,
    fps,
    updatedAt: new Date().toISOString(),
    items,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * .kf ファイルのテキストをパース
 */
export function parseKfFileContent(content: string): RetakeItem[] {
  try {
    const parsed = JSON.parse(content) as Partial<KfFileFormat>;
    if (Array.isArray(parsed.items)) {
      return parsed.items.map((it, idx) => ({
        id: it.id || `item_${Date.now()}_${idx}`,
        timecode: it.timecode || '00:00:00+00',
        frame: typeof it.frame === 'number' ? it.frame : 0,
        tag: it.tag || '修正',
        text: it.text || '',
      }));
    }
  } catch (err) {
    logDebug('roll', `Failed to parse .kf file: ${err}`, undefined, 'warn');
  }
  return [];
}

/**
 * コピー用プレーンテキストを構築
 */
export function buildExportText(videoName: string, items: RetakeItem[]): string {
  if (items.length === 0) return `【${videoName} リテイクメモ】\n(メモなし)`;

  const lines = items.map((it) => {
    const tagStr = it.tag ? `【${it.tag}】 ` : '';
    return `・[${it.timecode} (コマ:${it.frame})] ${tagStr}${it.text}`;
  });

  return `【${videoName} リテイク指示メモ】\n${lines.join('\n')}`;
}
