import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Video, Lock, User, Play, Volume2, VolumeX, Maximize, Minimize, Radio, AlertTriangle } from 'lucide-react';
import { normalizeViewerName, shareStatus, MAX_VIEWER_NAME_LENGTH } from '../../engine/rushAccess';
import {
  fetchRushShare,
  heartbeatRushShareViewer,
  registerRushShareViewer,
  RushShareDoc,
  RushShareError,
  subscribeRushShare,
  verifyRushShareAccess,
} from '../../engine/rushShareService';
import { useRushSharedPlayback } from '../../hooks/useRushPlaybackSync';

const FPS = 24;
const HEARTBEAT_MS = 30 * 1000;
const NAME_STORAGE_KEY = 'kingfisher_rush_guest_name';

function formatTC(sec: number): string {
  const s = Math.max(0, sec);
  const total = Math.floor(s);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  const f = String(Math.floor((s % 1) * FPS)).padStart(2, '0');
  return `${h}:${m}:${ss}+${f}`;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // 保存できなくても視聴はできる
  }
}

function describeError(err: unknown): string {
  if (err instanceof RushShareError) return err.message;
  const code = (err as { code?: string } | null)?.code || '';
  if (code.includes('permission-denied')) return 'この共有は終了したか、有効期限が切れています。';
  if (code.includes('unavailable')) return '接続できません。ネットワークを確認してください。';
  return '読み込みに失敗しました。時間をおいてもう一度お試しください。';
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'form'; share: RushShareDoc }
  | { kind: 'closed'; message: string }
  | {
      kind: 'watch';
      share: RushShareDoc;
      accessKey: string;
      viewerId: string;
      name: string;
      videoUrl: string | null;
      playbackId: string | null;
    };

/**
 * 社外の人がログインなしで開く視聴ページ (/watch/{共有ID})。
 *
 * 名前とパスワードを入れると、ホスト (オペレーター) の再生に合わせて動画が流れる。
 * 自分では再生位置を動かせない。名前は透かしとして映像に重ね、ホスト側の一覧にも出る。
 *
 * ⚠️ ペイントの画面 (App) とは別に描く。App は社内の Google ログインを前提にしている。
 */
export const RushGuestWatch: React.FC<{ shareId: string }> = ({ shareId }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchRushShare(shareId)
      .then((share) => {
        if (cancelled) return;
        if (!share) {
          setPhase({ kind: 'closed', message: 'この URL の共有は見つかりませんでした。URL をご確認ください。' });
          return;
        }
        const status = shareStatus(share, Date.now());
        if (status === 'revoked') setPhase({ kind: 'closed', message: 'この共有は終了しました。' });
        else if (status === 'expired') setPhase({ kind: 'closed', message: 'この共有は有効期限が切れています。' });
        else {
          document.title = `${share.roomName} - ラッシュ試写`;
          setPhase({ kind: 'form', share });
        }
      })
      .catch((err) => !cancelled && setPhase({ kind: 'closed', message: describeError(err) }));
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col">
      {phase.kind === 'loading' && (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">読み込み中...</div>
      )}
      {phase.kind === 'closed' && <ClosedScreen message={phase.message} />}
      {phase.kind === 'form' && (
        <JoinForm
          shareId={shareId}
          share={phase.share}
          onJoined={(joined) => setPhase({ kind: 'watch', share: phase.share, ...joined })}
          onClosed={(message) => setPhase({ kind: 'closed', message })}
        />
      )}
      {phase.kind === 'watch' && (
        <WatchScreen
          shareId={shareId}
          share={phase.share}
          accessKey={phase.accessKey}
          viewerId={phase.viewerId}
          name={phase.name}
          videoUrl={phase.videoUrl}
          playbackId={phase.playbackId}
          onClosed={(message) => setPhase({ kind: 'closed', message })}
        />
      )}
    </div>
  );
};

const ClosedScreen: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex-1 flex items-center justify-center p-6">
    <div className="max-w-sm text-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center mx-auto text-slate-400">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <p className="text-sm text-slate-300 leading-relaxed">{message}</p>
      <p className="text-xs text-slate-500">ご不明な点は、共有した担当者にお問い合わせください。</p>
    </div>
  </div>
);

const JoinForm: React.FC<{
  shareId: string;
  share: RushShareDoc;
  onJoined: (joined: {
    accessKey: string;
    viewerId: string;
    name: string;
    videoUrl: string | null;
    playbackId: string | null;
  }) => void;
  onClosed: (message: string) => void;
}> = ({ shareId, share, onJoined, onClosed }) => {
  const [name, setName] = useState(readSavedName);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const normalized = normalizeViewerName(name);
    if (!normalized) {
      setError(`お名前を ${MAX_VIEWER_NAME_LENGTH} 文字以内で入力してください`);
      return;
    }
    if (!password.trim()) {
      setError('パスワードを入力してください');
      return;
    }
    setIsJoining(true);
    try {
      const { access, accessKey } = await verifyRushShareAccess(shareId, password.trim());
      const viewerId = crypto.randomUUID();
      await registerRushShareViewer(shareId, accessKey, viewerId, normalized);
      saveName(normalized);
      onJoined({ accessKey, viewerId, name: normalized, videoUrl: access.videoUrl, playbackId: access.playbackId });
    } catch (err) {
      console.error('Failed to join rush share:', err);
      if (err instanceof RushShareError && (err.reason === 'revoked' || err.reason === 'expired' || err.reason === 'not-found')) {
        onClosed(err.message);
        return;
      }
      setError(describeError(err));
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm bg-slate-900 border border-amber-500/30 rounded-xl shadow-2xl p-6 space-y-4"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <Video className="w-5 h-5" />
            <span>ラッシュ試写</span>
          </div>
          <h1 className="text-base font-bold text-slate-100 break-words">{share.roomName}</h1>
          <p className="text-[11px] text-slate-400">有効期限: {formatDateTime(share.expiresAt)} まで</p>
        </div>

        <label className="block text-xs">
          <span className="text-slate-300 font-bold">お名前</span>
          <div className="relative mt-1">
            <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_VIEWER_NAME_LENGTH}
              placeholder="例: 山田 (〇〇スタジオ)"
              autoComplete="name"
              className="w-full bg-slate-950 border border-white/15 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400"
            />
          </div>
        </label>

        <label className="block text-xs">
          <span className="text-slate-300 font-bold">パスワード</span>
          <div className="relative mt-1">
            <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="共有されたパスワード"
              autoComplete="off"
              className="w-full bg-slate-950 border border-white/15 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400"
            />
          </div>
        </label>

        {error && <p className="text-xs text-red-300 bg-red-950/50 border border-red-500/40 rounded-lg p-2">{error}</p>}

        <button
          type="submit"
          disabled={isJoining}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold rounded-lg text-sm transition-colors"
        >
          {isJoining ? '確認中...' : '視聴する'}
        </button>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          お名前は配信者に表示され、映像にも透かしとして重なります。本映像は関係者限りです。
        </p>
      </form>
    </div>
  );
};

const WatchScreen: React.FC<{
  shareId: string;
  share: RushShareDoc;
  accessKey: string;
  viewerId: string;
  name: string;
  videoUrl: string | null;
  playbackId: string | null;
  onClosed: (message: string) => void;
}> = ({ shareId, share, accessKey, viewerId, name, videoUrl, playbackId, onClosed }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const follower = useRushSharedPlayback({ videoRef, videoUrl, playbackId, fps: FPS, canControl: false });

  // 停止・期限切れを見張る
  useEffect(() => {
    const unsubscribe = subscribeRushShare(shareId, (doc) => {
      if (!doc) onClosed('この共有は終了しました。');
      else if (shareStatus(doc, Date.now()) === 'revoked') onClosed('この共有は終了しました。');
    });
    const untilExpiry = share.expiresAt - Date.now();
    const timer = setTimeout(() => onClosed('この共有は有効期限が切れました。'), Math.max(0, Math.min(untilExpiry, 2 ** 31 - 1)));
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [shareId, share.expiresAt, onClosed]);

  // 在席の合図 (ホストの一覧で「視聴中」と出る)
  useEffect(() => {
    const beat = () =>
      void heartbeatRushShareViewer(shareId, accessKey, viewerId).catch((err) =>
        console.warn('Failed to send viewer heartbeat:', err)
      );
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [shareId, accessKey, viewerId]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      // 透かしごと全画面にするため、<video> ではなく枠を全画面にする
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch (err) {
      console.error('Fullscreen failed:', err);
    }
  };

  const watermarkText = useMemo(() => `${name} · ${formatDateTime(Date.now())} · 関係者限り`, [name]);
  const state = follower.state;
  const statusText = follower.error
    ? follower.error
    : !playbackId
      ? '配信の準備中です'
      : !state
        ? '接続しています...'
        : state.playing
          ? '配信者の再生に合わせています'
          : '配信者が一時停止中です';

  return (
    <div className="flex-1 flex flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-2 bg-slate-900 border-b border-white/10 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Video className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="font-bold text-amber-200 truncate">{share.roomName}</span>
          {state?.live && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white font-bold text-[10px] animate-pulse flex-shrink-0">
              <Radio className="w-3 h-3" />
              LIVE
            </span>
          )}
        </div>
        <span className="text-slate-400 truncate">視聴者: {name}</span>
      </header>

      <div
        ref={containerRef}
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            muted={muted}
            playsInline
            disablePictureInPicture
            controlsList="nodownload noplaybackrate"
            onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
            onSeeked={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
            className="w-full h-full max-h-[calc(100vh-96px)] object-contain"
          />
        ) : (
          <p className="text-sm text-slate-500">映像はまだありません</p>
        )}

        {/* 透かし: 画面全体に薄く敷き、右下にもはっきり出す */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <div className="absolute -inset-1/2 flex flex-wrap content-start gap-x-24 gap-y-20 rotate-[-24deg] opacity-[0.13]">
            {Array.from({ length: 60 }).map((_, i) => (
              <span key={i} className="text-white text-sm font-bold whitespace-nowrap">
                {watermarkText}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute bottom-3 right-3 pointer-events-none text-[11px] font-bold text-white/70 bg-black/40 px-2 py-0.5 rounded">
          {watermarkText}
        </div>

        {/* 状態とタイムコード */}
        <div className="absolute top-3 left-3 flex flex-col gap-1 items-start">
          <span className="font-mono text-amber-300 font-bold text-xs bg-black/70 px-2 py-0.5 rounded border border-white/10">
            {formatTC(currentTime)}
          </span>
          <span className="text-[10px] text-slate-300 bg-black/60 px-2 py-0.5 rounded">{statusText}</span>
        </div>

        {follower.needsGesture && (
          <button
            onClick={follower.unlock}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/60"
          >
            <span className="flex items-center gap-2 px-5 py-3 rounded-full bg-amber-500 text-slate-950 font-bold text-sm shadow-2xl">
              <Play className="w-5 h-5 fill-current" />
              タップして視聴を開始
            </span>
          </button>
        )}

        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 z-10">
          <button
            onClick={() => setMuted((m) => !m)}
            title={muted ? '音を出す' : 'ミュート'}
            className="p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-white border border-white/20"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          {document.fullscreenEnabled && (
            <button
              onClick={() => void toggleFullscreen()}
              title={isFullscreen ? '元のサイズに戻す' : '全画面'}
              className="p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-white border border-white/20"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      <footer className="px-4 py-1.5 bg-slate-900 border-t border-white/10 text-[10px] text-slate-500 flex justify-between gap-2">
        <span>再生・停止・位置は配信者の操作に合わせて動きます</span>
        <span className="flex-shrink-0">有効期限 {formatDateTime(share.expiresAt)}</span>
      </footer>
    </div>
  );
};
