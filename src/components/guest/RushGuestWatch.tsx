import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Video, Lock, User, Play, Volume2, VolumeX, Maximize, Minimize, Radio, AlertTriangle } from 'lucide-react';
import { normalizeViewerName, shareStatus, MAX_VIEWER_NAME_LENGTH } from '../../engine/rushAccess';
import {
  fetchRushShare,
  heartbeatRushShareViewer,
  RushShareDoc,
  subscribeRushShare,
} from '../../engine/rushShareService';
import { joinRushShare, refreshRushShareVideoUrl } from '../../engine/rushFunctions';
import { describeRushError, isRushShareClosed } from '../../engine/rushErrors';
import { useRushSharedPlayback } from '../../hooks/useRushPlaybackSync';
import { RushPointerLayer } from '../common/RushPointerLayer';

const FPS = 24;
const HEARTBEAT_MS = 30 * 1000;
/** 署名が切れるこれだけ前に URL を取り直す */
const URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;
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

type Phase =
  | { kind: 'loading' }
  | { kind: 'form'; share: RushShareDoc }
  | { kind: 'closed'; message: string }
  | {
      kind: 'watch';
      share: RushShareDoc;
      password: string;
      viewerId: string;
      name: string;
      videoUrl: string;
      videoUrlExpiresAt: number;
      playbackId: string | null;
    };

/**
 * 社外の人がログインなしで開く視聴ページ (/watch/{共有ID})。
 *
 * 名前とパスワードを入れると、ホスト (オペレーター) の再生に合わせて動画が流れる。
 * 自分では再生位置を動かせない。名前はホスト側の視聴者一覧に出る。
 *
 * ⚠️ 映像の上に文字を重ねないこと。ラッシュは動きを細かく見るための配信で、
 * 透かしのような重ね表示はチェックの邪魔になる (2026-09-21 の指示)。
 *
 * ⚠️ ペイントの画面 (App) とは別に描く。App は社内の Google ログインを前提にしている。
 */
export const RushGuestWatch: React.FC<{ shareId: string }> = ({ shareId }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!shareId) {
      // メールなどで URL が折り返されて切れている場合がある
      setPhase({
        kind: 'closed',
        message: '視聴用の URL が正しくありません。URL が途中で切れていないか、案内のメッセージをご確認ください。',
      });
      return;
    }
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
      .catch((err) => !cancelled && setPhase({ kind: 'closed', message: describeRushError(err) }));
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  return (
    <div
      className={`w-full text-slate-100 flex flex-col ${
        phase.kind === 'watch' ? 'fixed inset-0 bg-black overflow-hidden' : 'min-h-screen bg-slate-950'
      }`}
    >
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
          password={phase.password}
          viewerId={phase.viewerId}
          name={phase.name}
          initialVideoUrl={phase.videoUrl}
          initialExpiresAt={phase.videoUrlExpiresAt}
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
    password: string;
    viewerId: string;
    name: string;
    videoUrl: string;
    videoUrlExpiresAt: number;
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
      // 合言葉の照合と視聴者の登録はサーバー側 (試行回数を制限するため)。
      // 動画は寿命 30 分の署名付き URL で受け取る
      const joined = await joinRushShare(shareId, password.trim(), normalized);
      saveName(normalized);
      onJoined({
        password: password.trim(),
        viewerId: joined.viewerId,
        name: normalized,
        videoUrl: joined.videoUrl,
        videoUrlExpiresAt: joined.expiresAt,
        playbackId: joined.playbackId,
      });
    } catch (err) {
      console.error('Failed to join rush share:', err);
      if (isRushShareClosed(err)) {
        onClosed(describeRushError(err));
        return;
      }
      setError(describeRushError(err));
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
          お名前は配信者の画面に表示されます。本映像は関係者限りです。
        </p>
      </form>
    </div>
  );
};

const WatchScreen: React.FC<{
  shareId: string;
  share: RushShareDoc;
  password: string;
  viewerId: string;
  name: string;
  initialVideoUrl: string;
  initialExpiresAt: number;
  playbackId: string | null;
  onClosed: (message: string) => void;
}> = ({ shareId, share, password, viewerId, name, initialVideoUrl, initialExpiresAt, playbackId, onClosed }) => {
  const [videoUrl, setVideoUrl] = useState(initialVideoUrl);
  const [urlExpiresAt, setUrlExpiresAt] = useState(initialExpiresAt);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** 操作類を出しているか (動かしたら出して、しばらくすると消す) */
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = setTimeout(() => setChromeVisible(false), 2500);
  }, []);

  useEffect(() => {
    showChrome();
    return () => {
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
  }, [showChrome]);
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
      void heartbeatRushShareViewer(shareId, viewerId).catch((err) =>
        console.warn('Failed to send viewer heartbeat:', err)
      );
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [shareId, viewerId]);

  /**
   * 署名が切れる前に URL を取り直す。
   * ⚠️ 差し替えると <video> は頭へ戻るので、位置と再生状態を戻す。細かいずれは同期が直す。
   */
  useEffect(() => {
    const wait = Math.max(5000, urlExpiresAt - Date.now() - URL_REFRESH_MARGIN_MS);
    const timer = setTimeout(async () => {
      try {
        const next = await refreshRushShareVideoUrl(shareId, password, viewerId);
        const video = videoRef.current;
        const resumeAt = video?.currentTime ?? 0;
        const wasPlaying = video ? !video.paused : false;
        setVideoUrl(next.videoUrl);
        setUrlExpiresAt(next.expiresAt);
        if (video) {
          const restore = () => {
            video.removeEventListener('loadedmetadata', restore);
            video.currentTime = resumeAt;
            if (wasPlaying) void video.play().catch(() => undefined);
          };
          video.addEventListener('loadedmetadata', restore);
        }
      } catch (err) {
        console.error('Failed to refresh rush video url:', err);
        if (isRushShareClosed(err)) onClosed(describeRushError(err));
        else setUrlExpiresAt((prev) => prev + 60 * 1000); // 1 分後にもう一度試す
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [shareId, password, viewerId, urlExpiresAt, onClosed]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      // 操作類ごと全画面にするため、<video> ではなく枠を全画面にする
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch (err) {
      console.error('Fullscreen failed:', err);
    }
  };

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
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden select-none"
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={showChrome}
      onTouchStart={showChrome}
    >
      {videoUrl ? (
        <video
          key="rush-guest-video"
          ref={videoRef}
          src={videoUrl}
          muted={muted}
          playsInline
          disablePictureInPicture
          controlsList="nodownload noplaybackrate"
          onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
          onSeeked={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
          className="w-full h-full object-contain"
        />
      ) : (
        <p className="text-sm text-slate-500">映像はまだありません</p>
      )}

      {/* 配信者が指している場所 (赤いポインター) */}
      <RushPointerLayer playbackId={playbackId} containerRef={containerRef} videoRef={videoRef} canBroadcast={false} />

      {/*
        操作と説明は、動かしたときだけ出す。
        ⚠️ ここにメニューや編集の機能を足さないこと。この画面はアプリを契約していない人が開く。
      */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          chromeVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 p-3 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-amber-300 font-bold text-xs bg-black/70 px-2 py-0.5 rounded border border-white/10">
              {formatTC(currentTime)}
            </span>
            {state?.live && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white font-bold text-[10px] animate-pulse flex-shrink-0">
                <Radio className="w-3 h-3" />
                LIVE
              </span>
            )}
            <span className="text-[11px] text-slate-200 truncate">{share.roomName}</span>
          </div>
          <span className="text-[10px] text-slate-300 bg-black/50 px-2 py-0.5 rounded whitespace-nowrap">
            {statusText}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-2 p-3 bg-gradient-to-t from-black/70 to-transparent">
          <div className="flex items-center gap-1.5 pointer-events-auto">
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
          <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded whitespace-nowrap">
            視聴者: {name}
          </span>
        </div>
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
    </div>
  );
};
