import React, { useEffect, useRef, useState } from 'react';
import { Link2, Copy, Check, Ban, Trash2, Users, KeyRound, Clock, Shuffle } from 'lucide-react';
import {
  buildShareUrl,
  DEFAULT_SHARE_EXPIRY_MS,
  isViewerOnline,
  SHARE_EXPIRY_OPTIONS,
  shareStatus,
  ShareStatus,
} from '../../engine/rushAccess';
import { RushShareEntry } from '../../engine/rushService';
import {
  createRushShareInDB,
  removeRushShareEntriesInDB,
  revokeRushShareInDB,
  RushShareDoc,
  RushShareViewer,
  subscribeRushShare,
  subscribeRushShareViewers,
} from '../../engine/rushShareService';

const MIN_GUEST_PASSWORD_LENGTH = 4;

interface RushSharePanelProps {
  roomId: string;
  roomName: string;
  roomAccessKey: string;
  videoUrl: string | null;
  videoName: string | null;
  playbackId: string | null;
  shares: RushShareEntry[];
  userEmail: string;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 読み違えにくい文字だけで作る外部用パスワード */
function generateGuestPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function buildGuestInvite(roomName: string, entry: RushShareEntry): string {
  return [
    '[ラッシュ試写のご案内]',
    `タイトル: ${roomName}`,
    `URL: ${buildShareUrl(window.location.origin, entry.shareId)}`,
    `パスワード: ${entry.password}`,
    `有効期限: ${formatDateTime(entry.expiresAt)} まで`,
    '※ URL を開き、お名前とパスワードを入力するとご覧いただけます。',
    '※ 本映像は関係者限りです。URL・パスワードの転送、録画・撮影はご遠慮ください。',
  ].join('\n');
}

/**
 * オペレーター画面の「外部共有」タブ。
 * 社外の人向けの視聴 URL を発行し、視聴している人の名前を一覧する。
 */
export const RushSharePanel: React.FC<RushSharePanelProps> = ({
  roomId,
  roomName,
  roomAccessKey,
  videoUrl,
  videoName,
  playbackId,
  shares,
  userEmail,
}) => {
  const [password, setPassword] = useState(generateGuestPassword);
  const [expiresInMs, setExpiresInMs] = useState(DEFAULT_SHARE_EXPIRY_MS);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [statuses, setStatuses] = useState<Record<string, RushShareDoc | null>>({});
  const [now, setNow] = useState(Date.now());

  // 期限切れの表示を進めるため
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.trim().length < MIN_GUEST_PASSWORD_LENGTH) {
      setError(`パスワードは ${MIN_GUEST_PASSWORD_LENGTH} 文字以上にしてください`);
      return;
    }
    if (!playbackId) {
      setError('再生状態の準備ができていません。少し待ってからもう一度お試しください');
      return;
    }
    setIsCreating(true);
    try {
      await createRushShareInDB({
        roomId,
        roomName,
        roomAccessKey,
        videoUrl,
        videoName,
        playbackId,
        password: password.trim(),
        expiresInMs,
        createdByEmail: userEmail,
      });
      setPassword(generateGuestPassword());
    } catch (err) {
      console.error('Failed to create rush share:', err);
      setError('共有 URL を発行できませんでした。通信状態と権限を確認してください');
    } finally {
      setIsCreating(false);
    }
  };

  const statusOf = (entry: RushShareEntry): ShareStatus => {
    const doc = statuses[entry.shareId];
    return shareStatus({ revoked: doc?.revoked ?? false, expiresAt: entry.expiresAt }, now);
  };

  const closedEntries = shares.filter((s) => statusOf(s) !== 'open');
  const sorted = [...shares].sort((a, b) => b.createdAt - a.createdAt);

  const handleClearClosed = async () => {
    try {
      await removeRushShareEntriesInDB(
        roomId,
        roomAccessKey,
        shares.filter((s) => statusOf(s) === 'open')
      );
    } catch (err) {
      console.error('Failed to clear rush shares:', err);
      setError('一覧を整理できませんでした');
    }
  };

  return (
    <div className="flex-1 p-3 overflow-y-auto space-y-4 text-xs">
      <form onSubmit={(e) => void handleCreate(e)} className="space-y-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-1.5 text-amber-300 font-bold">
          <Link2 className="w-3.5 h-3.5" />
          <span>社外の人に視聴 URL を発行</span>
        </div>
        <p className="text-[10px] text-slate-400 leading-normal">
          受け取った人は Google ログインなしで、名前とパスワードを入れて視聴できます。
          再生・停止・シークはこの画面の操作に合わせて動きます。
        </p>

        <label className="block">
          <span className="text-[10px] text-slate-300 font-bold">外部用パスワード (ルームの合言葉とは別)</span>
          <div className="flex gap-1 mt-1">
            <div className="relative flex-1">
              <KeyRound className="w-3 h-3 absolute left-2 top-2 text-slate-500" />
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-white/15 rounded pl-6 pr-2 py-1 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-amber-400"
              />
            </div>
            <button
              type="button"
              onClick={() => setPassword(generateGuestPassword())}
              title="作り直す"
              className="px-2 rounded bg-white/10 hover:bg-white/20 text-slate-300"
            >
              <Shuffle className="w-3 h-3" />
            </button>
          </div>
        </label>

        <label className="block">
          <span className="text-[10px] text-slate-300 font-bold">有効期限</span>
          <select
            value={expiresInMs}
            onChange={(e) => setExpiresInMs(Number(e.target.value))}
            className="mt-1 w-full bg-slate-950 border border-white/15 rounded px-2 py-1 text-slate-100 text-[11px]"
          >
            {SHARE_EXPIRY_OPTIONS.map((o) => (
              <option key={o.ms} value={o.ms}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {!videoUrl && <p className="text-[10px] text-amber-300">このルームには動画がないため、共有しても映像は出ません。</p>}
        {error && <p className="text-[10px] text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={isCreating || !playbackId}
          className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold rounded transition-colors flex items-center justify-center gap-1.5"
        >
          <Link2 className="w-3.5 h-3.5" />
          <span>{isCreating ? '発行中...' : !playbackId ? '準備中...' : '視聴 URL を発行'}</span>
        </button>
      </form>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-bold">発行済み ({shares.length})</span>
          {closedEntries.length > 0 && (
            <button
              onClick={() => void handleClearClosed()}
              className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
              title="停止・期限切れのものを一覧から消す"
            >
              <Trash2 className="w-3 h-3" />
              終了したものを消す
            </button>
          )}
        </div>
        {sorted.length === 0 ? (
          <p className="text-[10px] text-slate-500 text-center py-4">まだ発行していません</p>
        ) : (
          sorted.map((entry) => (
            <ShareRow
              key={entry.shareId}
              entry={entry}
              roomName={roomName}
              status={statusOf(entry)}
              now={now}
              onDoc={(doc) => setStatuses((prev) => ({ ...prev, [entry.shareId]: doc }))}
            />
          ))
        )}
      </div>
    </div>
  );
};

const STATUS_LABEL: Record<ShareStatus, { text: string; className: string }> = {
  open: { text: '公開中', className: 'bg-emerald-500/20 text-emerald-300' },
  revoked: { text: '停止', className: 'bg-red-500/20 text-red-300' },
  expired: { text: '期限切れ', className: 'bg-slate-500/20 text-slate-400' },
};

const ShareRow: React.FC<{
  entry: RushShareEntry;
  roomName: string;
  status: ShareStatus;
  now: number;
  onDoc: (doc: RushShareDoc | null) => void;
}> = ({ entry, roomName, status, now, onDoc }) => {
  const [viewers, setViewers] = useState<RushShareViewer[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // 親が毎回新しい関数を渡してくるので、購読し直さないよう ref 経由で呼ぶ
  const onDocRef = useRef(onDoc);
  onDocRef.current = onDoc;
  useEffect(() => subscribeRushShare(entry.shareId, (doc) => onDocRef.current(doc)), [entry.shareId]);
  useEffect(
    () => subscribeRushShareViewers(entry.shareId, entry.accessKey, setViewers),
    [entry.shareId, entry.accessKey]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildGuestInvite(roomName, entry));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm('この視聴 URL を停止しますか？ 視聴中の人の画面も止まります。')) return;
    setBusy(true);
    try {
      await revokeRushShareInDB(entry.shareId);
    } catch (err) {
      console.error('Failed to revoke rush share:', err);
      alert('停止できませんでした。通信状態と権限を確認してください。');
    } finally {
      setBusy(false);
    }
  };

  const online = viewers.filter((v) => status === 'open' && isViewerOnline(v.lastSeenAt, now));
  const label = STATUS_LABEL[status];

  return (
    <div className={`p-2 rounded border space-y-1.5 ${status === 'open' ? 'bg-slate-950 border-white/10' : 'bg-slate-950/50 border-white/5 opacity-70'}`}>
      <div className="flex items-center justify-between gap-1">
        <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${label.className}`}>{label.text}</span>
        <span className="text-[10px] text-slate-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDateTime(entry.expiresAt)} まで
        </span>
      </div>
      <p className="font-mono text-[10px] text-slate-300 break-all">
        {buildShareUrl(window.location.origin, entry.shareId)}
      </p>
      <p className="font-mono text-[10px] text-slate-400">パスワード: {entry.password}</p>

      {status === 'open' && (
        <div className="flex gap-1">
          <button
            onClick={() => void handleCopy()}
            className="flex-1 py-1 rounded bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center gap-1 text-[10px] font-bold"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'コピーしました' : '招待文をコピー'}
          </button>
          <button
            onClick={() => void handleRevoke()}
            disabled={busy}
            className="px-2 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-500/30 text-red-300 flex items-center gap-1 text-[10px] font-bold disabled:opacity-40"
          >
            <Ban className="w-3 h-3" />
            停止
          </button>
        </div>
      )}

      <div className="pt-1 border-t border-white/5">
        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold mb-1">
          <Users className="w-3 h-3" />
          視聴者 {viewers.length} 人 (視聴中 {online.length})
        </div>
        {viewers.map((v) => {
          const isOnline = status === 'open' && isViewerOnline(v.lastSeenAt, now);
          return (
            <div key={v.id} className="flex items-center justify-between text-[10px] py-0.5">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="truncate text-slate-200">{v.name}</span>
              </span>
              <span className="text-slate-500 font-mono flex-shrink-0">{formatDateTime(v.joinedAt).slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
