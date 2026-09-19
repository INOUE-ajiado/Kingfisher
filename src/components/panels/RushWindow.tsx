import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Disc,
  Users,
  Check,
  LogOut,
  Clock,
  Plus,
  Trash2,
  Tag,
  History,
  FileCode,
  Share2,
  Maximize,
  Minimize,
  Shield,
  UserPlus,
  UserX,
} from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { RetakeItem } from '../../engine/retakeStore';
import { db, isAjiadoDomain } from '../../engine/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { updateRushRoomStatusInDB, updateRushRoomOperatorsInDB } from '../../engine/rushService';
import { RushThumbnailBar } from './RushThumbnailBar';

export const RushWindow: React.FC = () => {
  const roomId = usePaintStore((s) => s.roomId);
  const isHost = usePaintStore((s) => s.isHost);
  const roomName = usePaintStore((s) => s.roomName);
  const passwordHash = usePaintStore((s) => s.passwordHash);
  const videoUrl = usePaintStore((s) => s.videoUrl);
  const isLive = usePaintStore((s) => s.isLive);
  const isRecording = usePaintStore((s) => s.isRecording);
  const isMicMuted = usePaintStore((s) => s.isMicMuted);
  const isSpeakerMuted = usePaintStore((s) => s.isSpeakerMuted);
  const participants = usePaintStore((s) => s.participants);
  const retakeItems = usePaintStore((s) => s.retakeItems);
  const archives = usePaintStore((s) => s.archives);
  const user = usePaintStore((s) => s.user);

  const leaveRushRoom = usePaintStore((s) => s.leaveRushRoom);
  const setRushLive = usePaintStore((s) => s.setRushLive);
  const setRushRecording = usePaintStore((s) => s.setRushRecording);
  const setRushMicMuted = usePaintStore((s) => s.setRushMicMuted);
  const setRushSpeakerMuted = usePaintStore((s) => s.setRushSpeakerMuted);
  const updateRushRetakes = usePaintStore((s) => s.updateRushRetakes);
  const addRushArchive = usePaintStore((s) => s.addRushArchive);
  const openRushAuthModal = usePaintStore((s) => s.openRushAuthModal);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fps] = useState(24);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 右サイドバータブ
  const [sideTab, setSideTab] = useState<'retakes' | 'users' | 'archives'>('retakes');

  // リテイクメモ入力フォーム
  const [inputText, setInputText] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('撮影');

  // オペレーター管理 State
  const [operatorEmails, setOperatorEmails] = useState<string[]>([]);
  const [newOpEmail, setNewOpEmail] = useState('');
  const [hostEmail, setHostEmail] = useState('');

  // Firestore のオペレーター一覧をリアルタイム同期 ＆ 権限判定
  useEffect(() => {
    if (!roomId) return;
    const roomRef = doc(db, 'rushRooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const ops: string[] = data.operatorEmails || [];
        const hEmail: string = (data.hostEmail || '').trim().toLowerCase();
        setHostEmail(hEmail);
        setOperatorEmails(ops);

        // 自分（ログインユーザー）がホストまたはオペレーターリストに含まれていれば isHost = true
        const myEmail = (user?.email || '').trim().toLowerCase();
        if (myEmail) {
          const hasOperatorPrivilege =
            myEmail === hEmail || ops.map((e) => e.trim().toLowerCase()).includes(myEmail);
          if (hasOperatorPrivilege !== isHost) {
            usePaintStore.setState({ isHost: hasOperatorPrivilege });
          }
        }
      }
    });
    return () => unsubscribe();
  }, [roomId, user?.email, isHost]);

  // オペレーター追加
  const handleAddOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newOpEmail.trim().toLowerCase();
    if (!trimmed || !roomId) return;

    if (!isAjiadoDomain(trimmed)) {
      alert('@ajiado.co.jp のメールアドレスを指定してください');
      return;
    }

    if (operatorEmails.map((e) => e.toLowerCase()).includes(trimmed)) {
      setNewOpEmail('');
      return;
    }

    const newOps = [...operatorEmails, trimmed];
    setOperatorEmails(newOps);
    setNewOpEmail('');
    await updateRushRoomOperatorsInDB(roomId, newOps);
  };

  // オペレーター権限解除
  const handleRemoveOperator = async (emailToRemove: string) => {
    if (!roomId) return;
    const newOps = operatorEmails.filter((e) => e.toLowerCase() !== emailToRemove.toLowerCase());
    setOperatorEmails(newOps);
    await updateRushRoomOperatorsInDB(roomId, newOps);
  };

  // フルスクリーン状態の変更検知
  useEffect(() => {
    const handleFSChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFSChange);
    return () => document.removeEventListener('fullscreenchange', handleFSChange);
  }, []);

  // フルスクリーン切り替え (YouTube風)
  const toggleFullscreen = async () => {
    const elem = playerContainerRef.current || document.documentElement;
    if (!document.fullscreenElement) {
      try {
        await elem.requestFullscreen();
        setIsFullscreen(true);
      } catch (err) {
        console.error('Fullscreen request failed:', err);
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch (err) {
        console.error('Exit fullscreen failed:', err);
      }
    }
  };

  // 招待情報のコピー
  const handleCopyInvite = async () => {
    const inviteText = `[Kingfisher ラッシュ案内]\nルーム名: ${roomName}\nルームID: ${roomId}\nパスワード: ${passwordHash}\nURL: ${window.location.origin}/rush?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(inviteText);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  // タイムコード計算
  const formatTC = (sec: number) => {
    const total = Math.floor(sec);
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    const f = String(Math.floor((sec % 1) * fps)).padStart(2, '0');
    return `${h}:${m}:${s}+${f}`;
  };

  const currentFrame = Math.floor(currentTime * fps);

  // 再生制御
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      void videoRef.current.play();
    }
  };

  const stepFrame = (frames: number) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    const newTime = Math.max(0, Math.min(duration, currentTime + frames / fps));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  // キーボードショートカット (オペレーター専用)
  useEffect(() => {
    if (!isHost) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // フォーム入力中のキーイベントを無視
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? -10 : -1;
        stepFrame(step);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        stepFrame(step);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHost, isPlaying, duration, currentTime, fps]);

  // リテイクメモ追加
  const handleAddRetake = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const tc = formatTC(currentTime);
    const newItem: RetakeItem = {
      id: `rtk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timecode: tc,
      frame: currentFrame,
      tag: selectedTag,
      text: inputText.trim(),
    };

    updateRushRetakes([...retakeItems, newItem]);
    setInputText('');
  };

  const handleDeleteRetake = (id: string) => {
    updateRushRetakes(retakeItems.filter((item) => item.id !== id));
  };

  const handleSeekToRetake = (item: RetakeItem) => {
    if (videoRef.current && fps > 0) {
      videoRef.current.currentTime = item.frame / fps;
      setCurrentTime(item.frame / fps);
    }
  };

  // 録画トグル
  const handleToggleRecording = () => {
    if (isRecording) {
      setRushRecording(false);
      if (videoUrl) {
        addRushArchive({
          id: `arch_${Date.now()}`,
          title: `${roomName} 録画アーカイブ`,
          videoUrl: videoUrl,
          duration: currentTime,
          createdAt: Date.now(),
          retakeItems: [...retakeItems],
        });
      }
    } else {
      setRushRecording(true);
    }
  };

  if (!roomId) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-slate-950 text-slate-100 p-6 select-none">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
          <Video className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold mb-2">ラッシュ専用セッション</h2>
        <p className="text-xs text-slate-400 max-w-sm text-center mb-6 leading-relaxed">
          クラウドDBおよびWebRTC超低遅延配信を使用した、ラッシュ専用ルームです。
          招待URLとパスワードで参加者とリアルタイム共有できます。
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => openRushAuthModal('create')}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors flex items-center gap-2 shadow-lg shadow-amber-500/20"
          >
            <Radio className="w-4 h-4" />
            <span>新規ラッシュ配信を作成 (オペレーター)</span>
          </button>
          <button
            onClick={() => openRushAuthModal('join')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            <Users className="w-4 h-4" />
            <span>ラッシュセッションに参加 (一般画面)</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={playerContainerRef}
      className="flex flex-col w-full h-full bg-slate-950 text-slate-100 select-none overflow-hidden relative"
    >
      {/* 1. トップコントロールバー */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-white/10 text-xs flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase tracking-wider flex-shrink-0 ${
              isHost ? 'bg-amber-500/20 text-amber-300' : 'bg-indigo-500/20 text-indigo-300'
            }`}
          >
            {isHost ? 'オペレーター画面' : '一般画面 (視聴専用)'}
          </span>
          <h3 className="font-bold text-amber-200 truncate max-w-[200px]" title={roomName}>
            {roomName}
          </h3>
          <span className="font-mono text-[10px] text-slate-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
            ID: {roomId}
          </span>
        </div>

        {/* コントロールボタン群 */}
        <div className="flex items-center gap-2">
          {/* LIVE バッジ */}
          {isLive && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-600 text-white font-bold text-[10px] animate-pulse">
              <Radio className="w-3 h-3" />
              <span>LIVE</span>
            </span>
          )}

          {/* 録画バッジ (ホストのみ) */}
          {isHost && isRecording && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-600 text-white font-bold text-[10px] animate-pulse">
              <Disc className="w-3 h-3" />
              <span>REC</span>
            </span>
          )}

          {/* 配信切替 ＆ 録画切替 (ホストのみ) */}
          {isHost && (
            <>
              <button
                onClick={() => {
                  const nextLive = !isLive;
                  setRushLive(nextLive);
                  if (roomId) void updateRushRoomStatusInDB(roomId, { isLive: nextLive });
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition-colors ${
                  isLive
                    ? 'bg-red-600/20 text-red-300 border border-red-500/40 hover:bg-red-600/30'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>{isLive ? '配信停止' : '配信開始'}</span>
              </button>

              <button
                onClick={handleToggleRecording}
                className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition-colors ${
                  isRecording
                    ? 'bg-amber-600 text-white hover:bg-amber-500'
                    : 'bg-white/10 hover:bg-white/20 text-slate-200'
                }`}
              >
                <Disc className="w-3.5 h-3.5" />
                <span>{isRecording ? '録画停止' : '録画開始'}</span>
              </button>
            </>
          )}

          {/* マイク・スピーカーミュート */}
          <div className="flex items-center bg-slate-950 rounded border border-white/10 p-0.5">
            <button
              onClick={() => setRushMicMuted(!isMicMuted)}
              title={isMicMuted ? 'マイクミュート解除' : 'マイクミュート'}
              className={`p-1 rounded transition-colors ${
                isMicMuted ? 'text-red-400 bg-red-950/40' : 'text-slate-300 hover:text-white'
              }`}
            >
              {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setRushSpeakerMuted(!isSpeakerMuted)}
              title={isSpeakerMuted ? '音声ミュート解除' : '音声ミュート'}
              className={`p-1 rounded transition-colors ${
                isSpeakerMuted ? 'text-red-400 bg-red-950/40' : 'text-slate-300 hover:text-white'
              }`}
            >
              {isSpeakerMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* 招待コピー (ホストのみ) */}
          {isHost && (
            <button
              onClick={handleCopyInvite}
              title="招待情報・パスワードをコピー"
              className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-200 transition-colors flex items-center gap-1"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* 退室 */}
          <button
            onClick={leaveRushRoom}
            title="ルームから退室"
            className="p-1.5 rounded bg-red-950/60 hover:bg-red-900 border border-red-500/30 text-red-300 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. メイン領域 (オペレーター画面 / 一般画面) */}
      <div className="flex-1 flex overflow-hidden w-full">
        {/* ビデオプレイヤー領域 */}
        <div className="flex-1 flex flex-col bg-black relative w-full h-full min-w-0">
          <div className="flex-1 flex items-center justify-center relative overflow-hidden group w-full h-full">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                autoPlay
                muted={isSpeakerMuted}
                onTimeUpdate={() => {
                  if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                }}
                onLoadedMetadata={() => {
                  if (videoRef.current) setDuration(videoRef.current.duration);
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-center text-slate-500 p-6 select-none">
                <Video className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">映像ストリーム待機中...</p>
                <p className="text-xs opacity-70 mt-1">
                  ホストがクラウドへ映像を配信すると、自動的にこちらへ表示されます
                </p>
              </div>
            )}

            {/* タイムコード表示 (オペレーター時のみ) */}
            {isHost && (
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded border border-white/10 font-mono text-amber-300 font-bold text-xs tracking-wider">
                {formatTC(currentTime)} <span className="text-slate-400 font-normal">(f:{currentFrame})</span>
              </div>
            )}

            {/* 一般画面用: YouTube風 フルウィンドウ/フルスクリーンボタン (右下常時表示) */}
            {!isHost && (
              <div className="absolute bottom-4 right-4 z-50">
                <button
                  onClick={toggleFullscreen}
                  title={isFullscreen ? '通常表示に戻す' : 'YouTube風 フルスクリーン表示'}
                  className="p-2.5 rounded-lg bg-slate-900/80 hover:bg-amber-500 hover:text-slate-950 text-white border border-white/20 backdrop-blur-md transition-all shadow-2xl flex items-center gap-1.5 font-bold text-xs"
                >
                  {isFullscreen ? (
                    <>
                      <Minimize className="w-4 h-4" />
                      <span>元のサイズに戻す</span>
                    </>
                  ) : (
                    <>
                      <Maximize className="w-4 h-4" />
                      <span>フルウィンドウ表示</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* オペレーター専用: iMovie風 サムネイル コントロールバー */}
          {isHost && (
            <RushThumbnailBar
              videoRef={videoRef}
              videoUrl={videoUrl}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              onStepFrame={stepFrame}
              togglePlay={togglePlay}
              isPlaying={isPlaying}
              formatTC={formatTC}
            />
          )}
        </div>

        {/* オペレーター専用: 右サイドバー (リテイクメモ ＆ 参加者 ＆ アーカイブ) */}
        {isHost && (
          <div className="w-80 border-l border-white/10 bg-slate-900 flex flex-col flex-shrink-0">
            {/* タブ切り替え */}
            <div className="flex border-b border-white/10 bg-slate-950/60">
              <button
                onClick={() => setSideTab('retakes')}
                className={`flex-1 py-2 text-[11px] font-bold flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  sideTab === 'retakes'
                    ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>リテイク ({retakeItems.length})</span>
              </button>
              <button
                onClick={() => setSideTab('users')}
                className={`flex-1 py-2 text-[11px] font-bold flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  sideTab === 'users'
                    ? 'border-indigo-400 text-indigo-300 bg-indigo-400/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>参加者 ({participants.length || 1})</span>
              </button>
              <button
                onClick={() => setSideTab('archives')}
                className={`flex-1 py-2 text-[11px] font-bold flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  sideTab === 'archives'
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-400/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>録画 ({archives.length})</span>
              </button>
            </div>

            {/* タブコンテンツ */}
            {sideTab === 'retakes' && (
              <div className="flex-1 flex flex-col p-2 min-h-0">
                {/* 入力フォーム */}
                <form onSubmit={handleAddRetake} className="space-y-1.5 pb-2 border-b border-white/10">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-amber-300 font-bold">修正先:</span>
                    <select
                      value={selectedTag}
                      onChange={(e) => setSelectedTag(e.target.value)}
                      className="bg-slate-950 border border-white/20 rounded px-1.5 py-0.5 text-amber-300 font-bold text-[10px]"
                    >
                      {['撮影', '美術', '仕上げ', '動検', '監督', 'キャラデ', '作監', '確認'].map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-1.5">
                    <textarea
                      rows={2}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="リテイク指示を入力 (DB経由でリアルタイム共有)..."
                      className="flex-1 bg-slate-950 border border-white/15 rounded px-2 py-1 text-slate-100 text-[11px] focus:outline-none focus:border-amber-400 resize-none leading-normal"
                    />
                    <button
                      type="submit"
                      className="px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs transition-colors flex items-center justify-center"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </form>

                {/* メモ一覧 */}
                <div className="flex-1 overflow-y-auto space-y-1 py-2 pr-1">
                  {retakeItems.length === 0 ? (
                    <div className="text-center text-slate-500 py-8 select-none">
                      <Tag className="w-6 h-6 mx-auto mb-1 opacity-40" />
                      <p className="text-xs">リテイク指示はありません</p>
                    </div>
                  ) : (
                    retakeItems.map((it) => (
                      <div
                        key={it.id}
                        onClick={() => handleSeekToRetake(it)}
                        className="p-1.5 rounded bg-white/5 hover:bg-white/10 border border-white/5 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center justify-between text-[9px] font-mono text-amber-300">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-indigo-400" />
                            <span>{it.timecode}</span>
                            <span className="px-1 bg-amber-400/20 text-amber-300 rounded font-bold">{it.tag}</span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRetake(it.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-slate-200 text-[11px] mt-0.5 whitespace-pre-wrap leading-tight">
                          {it.text}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {sideTab === 'users' && (
              <div className="flex-1 p-3 overflow-y-auto space-y-4">
                {/* オペレーター権限追加・管理セクション */}
                <div className="space-y-2 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    <span>オペレーター権限の管理</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    権限を追加されたユーザーはオペレーター専用画面に昇格し、映像操作やリテイク指示が可能になります。
                  </p>

                  {/* 追加フォーム */}
                  <form onSubmit={handleAddOperator} className="flex gap-1 mt-2">
                    <input
                      type="email"
                      value={newOpEmail}
                      onChange={(e) => setNewOpEmail(e.target.value)}
                      placeholder="email@ajiado.co.jp"
                      className="flex-1 bg-slate-950 border border-white/15 rounded px-2 py-1 text-slate-100 text-[11px] focus:outline-none focus:border-amber-400"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-[10px] transition-colors flex items-center gap-1 flex-shrink-0"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>追加</span>
                    </button>
                  </form>

                  {/* オペレーター一覧 */}
                  <div className="space-y-1 mt-2">
                    <span className="text-[10px] text-slate-400 font-bold block">現在のオペレーター:</span>
                    {operatorEmails.map((opEmail) => {
                      const isCreator = hostEmail && opEmail.toLowerCase() === hostEmail.toLowerCase();
                      return (
                        <div
                          key={opEmail}
                          className="flex items-center justify-between p-1.5 rounded bg-slate-950 border border-white/10 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <Shield className="w-3 h-3 text-amber-400 flex-shrink-0" />
                            <span className="truncate font-mono">{opEmail}</span>
                            {isCreator && (
                              <span className="text-[9px] bg-amber-400/20 text-amber-300 px-1 rounded font-bold flex-shrink-0">
                                作成者
                              </span>
                            )}
                          </div>
                          {!isCreator && (
                            <button
                              onClick={() => handleRemoveOperator(opEmail)}
                              title="オペレーター権限を解除"
                              className="p-1 text-red-400 hover:text-red-300 hover:bg-white/10 rounded transition-colors"
                            >
                              <UserX className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 参加メンバー一覧 */}
                <div>
                  <h4 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-2">
                    オンラインメンバー
                  </h4>
                  <div className="flex items-center justify-between p-2 rounded bg-white/5 border border-white/5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="font-bold text-xs">{isHost ? '自分 (オペレーター)' : '自分 (視聴者)'}</span>
                    </div>
                    <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                      {isHost ? 'OPERATOR' : 'GUEST'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {sideTab === 'archives' && (
              <div className="flex-1 p-3 overflow-y-auto space-y-2">
                <h4 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-2">
                  セッション録画アーカイブ
                </h4>
                {archives.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">録画アーカイブはありません</p>
                ) : (
                  archives.map((arch) => (
                    <div key={arch.id} className="p-2 rounded bg-white/5 border border-white/5 space-y-1">
                      <p className="font-bold text-xs text-amber-200">{arch.title}</p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {new Date(arch.createdAt).toLocaleTimeString()} · リテイク {arch.retakeItems.length} 件
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
