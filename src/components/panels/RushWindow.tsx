import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Video,
  Volume2,
  VolumeX,
  Radio,
  Users,
  Check,
  LogOut,
  Clock,
  Plus,
  Trash2,
  Tag,
  FileCode,
  Share2,
  Maximize,
  Minimize,
  Shield,
  UserPlus,
  UserX,
  MousePointer2,
  Pencil,
  Eraser,
  Link2,
  Play,
} from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { RetakeItem } from '../../engine/retakeStore';
import { isAjiadoDomain } from '../../engine/firebase';
import {
  updateRushRoomStatusInDB,
  updateRushRoomOperatorsInDB,
  subscribeRushRoom,
  subscribeRushAccess,
  subscribeRushRetakes,
  addRushRetakeInDB,
  deleteRushRetakeInDB,
  attachRushPlaybackInDB,
  joinRushParticipantInDB,
  heartbeatRushParticipantInDB,
  leaveRushParticipantInDB,
  subscribeRushParticipants,
  RushParticipantDoc,
  RushShareEntry,
} from '../../engine/rushService';
import { subscribeRushShareViewers, RushShareViewer } from '../../engine/rushShareService';
import { useRushSharedPlayback } from '../../hooks/useRushPlaybackSync';
import { RushSharePanel } from './RushSharePanel';
import { RushPointerLayer } from '../common/RushPointerLayer';
import {
  clampPointerBlur,
  clampPointerSize,
  clampStrokeSize,
  defaultPointerColor,
  DEFAULT_POINTER_BLUR,
  DEFAULT_POINTER_SIZE,
  DEFAULT_STROKE_SIZE,
  isPointerColor,
  MAX_POINTER_SIZE,
  MAX_STROKE_SIZE,
  MIN_POINTER_SIZE,
  MIN_STROKE_SIZE,
  POINTER_COLORS,
  pointerGlow,
  withAlpha,
} from '../../engine/rushPointerMath';
import {
  buildRushInviteUrl,
  hasOperatorPrivilege,
  isPresenceVisible,
  isViewerOnline,
  normalizeEmail,
  PRESENCE_STALE_MS,
  stablePresenceId,
} from '../../engine/rushAccess';
import { describeFunctionError, getRushRoomVideoUrl } from '../../engine/rushFunctions';
import { describeBuild, readBuildEnv } from '../../engine/buildInfo';
import { RushThumbnailBar } from './RushThumbnailBar';

const POINTER_SETTING_KEY = 'kingfisher_rush_pointer_v1';

/** ポインターの見た目の覚え書き (この端末だけ。読めなくても動く) */
function readPointerSetting(key: 'color' | 'size' | 'blur' | 'strokeSize', fallback: string): string {
  try {
    const raw = localStorage.getItem(POINTER_SETTING_KEY);
    const value = raw ? (JSON.parse(raw) as Record<string, string>)[key] : null;
    if (key === 'color') return value && isPointerColor(value) ? value : fallback;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writePointerSetting(color: string, size: number, blur: number, strokeSize: number): void {
  try {
    localStorage.setItem(
      POINTER_SETTING_KEY,
      JSON.stringify({ color, size: String(size), blur: String(blur), strokeSize: String(strokeSize) })
    );
  } catch {
    // 覚えられなくても、その場では使える
  }
}

export const RushWindow: React.FC = () => {
  const roomId = usePaintStore((s) => s.roomId);
  const isHost = usePaintStore((s) => s.isHost);
  const roomName = usePaintStore((s) => s.roomName);
  const roomPassword = usePaintStore((s) => s.roomPassword);
  const accessKey = usePaintStore((s) => s.rushAccessKey);
  const videoUrl = usePaintStore((s) => s.videoUrl);
  const thumbnails = usePaintStore((s) => s.rushThumbnails);
  const isMaximized = usePaintStore((s) => s.paneLayout.maximized === 'rush');
  const isLive = usePaintStore((s) => s.isLive);
  const isSpeakerMuted = usePaintStore((s) => s.isSpeakerMuted);
  const retakeItems = usePaintStore((s) => s.retakeItems);
  const user = usePaintStore((s) => s.user);

  const leaveRushRoom = usePaintStore((s) => s.leaveRushRoom);
  const setRushLive = usePaintStore((s) => s.setRushLive);
  const setRushSpeakerMuted = usePaintStore((s) => s.setRushSpeakerMuted);
  const updateRushRetakes = usePaintStore((s) => s.updateRushRetakes);
  const setRushVideo = usePaintStore((s) => s.setRushVideo);
  const setRushVideoMeta = usePaintStore((s) => s.setRushVideoMeta);
  const openRushAuthModal = usePaintStore((s) => s.openRushAuthModal);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  /** 映像を載せている枠 (共有するポインターの位置は、この中の映像を基準にする) */
  const videoAreaRef = useRef<HTMLDivElement | null>(null);

  /**
   * 共有するポインターの見た目。既定の色は人ごとに変える。
   * 選んだ色と大きさはこの端末に覚えておく (人によって好みが違うため)。
   */
  const myEmail = normalizeEmail(user?.email);
  const [pointerColor, setPointerColor] = useState(() => readPointerSetting('color', defaultPointerColor(myEmail)));
  const [pointerSize, setPointerSize] = useState(() =>
    clampPointerSize(Number(readPointerSetting('size', String(DEFAULT_POINTER_SIZE))))
  );
  const [pointerBlur, setPointerBlur] = useState(() =>
    clampPointerBlur(Number(readPointerSetting('blur', String(DEFAULT_POINTER_BLUR))))
  );
  const [strokeSize, setStrokeSize] = useState(() =>
    clampStrokeSize(Number(readPointerSetting('strokeSize', String(DEFAULT_STROKE_SIZE))))
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const clearStrokesRef = useRef<(() => void) | null>(null);
  const [pointerPanelOpen, setPointerPanelOpen] = useState(false);
  const pointerIdRef = useRef(`ptr_${Math.random().toString(36).slice(2, 10)}`);
  const pointerProfile = useMemo(
    () => ({
      name: user?.displayName || myEmail.split('@')[0] || 'オペレーター',
      color: pointerColor,
      size: pointerSize,
      blur: pointerBlur,
      strokeSize,
    }),
    [user?.displayName, myEmail, pointerColor, pointerSize, pointerBlur, strokeSize]
  );
  /** 最後にクリックした場所がこの面の中か (並べて表示しているときのキー操作の宛先) */
  const isPointerInsideRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fps] = useState(24);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 右サイドバータブ
  const [sideTab, setSideTab] = useState<'retakes' | 'users' | 'share'>('retakes');

  // 再生の同期と外部共有 (ルームの access 文書から)
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [playbackId, setPlaybackId] = useState<string | null>(null);
  const [shares, setShares] = useState<RushShareEntry[]>([]);
  const attachingPlaybackRef = useRef(false);

  // リテイクメモ入力フォーム
  const [inputText, setInputText] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('撮影');

  useEffect(() => {
    writePointerSetting(pointerColor, pointerSize, pointerBlur, strokeSize);
  }, [pointerColor, pointerSize, pointerBlur, strokeSize]);

  // 参加者 (社内は participants、社外は共有ごとの viewers)
  const [participants, setParticipants] = useState<RushParticipantDoc[]>([]);
  const [guestViewers, setGuestViewers] = useState<Record<string, RushShareViewer[]>>({});
  const [now, setNow] = useState(Date.now());
  const participantIdRef = useRef<string>('');

  // オペレーター管理 State
  const [operatorEmails, setOperatorEmails] = useState<string[]>([]);
  const [newOpEmail, setNewOpEmail] = useState('');
  const [hostEmail, setHostEmail] = useState('');

  /**
   * 再生はルーム全体で 1 つ。オペレーターも含めて全員がこの状態に追従し、
   * オペレーターの操作は自分の映像ではなく、この状態を書き換える。
   */
  const playback = useRushSharedPlayback({ videoRef, videoUrl, playbackId, fps, canControl: isHost });

  // ルームの文書 (オペレーター・LIVE) をリアルタイム同期 ＆ 権限判定
  useEffect(() => {
    if (!roomId) return;
    return subscribeRushRoom(roomId, (room) => {
      if (!room) {
        // 他の人がルームを削除した
        usePaintStore.getState().leaveRushRoom();
        window.alert('このラッシュルームは削除されました。');
        return;
      }
      setHostEmail(normalizeEmail(room.hostEmail));
      setOperatorEmails(room.operatorEmails || []);

      const store = usePaintStore.getState();
      const privileged = hasOperatorPrivilege(room, store.user?.email);
      if (privileged !== store.isHost) usePaintStore.setState({ isHost: privileged });
      if (!!room.isLive !== store.isLive) store.setRushLive(!!room.isLive);
    });
  }, [roomId, user?.email]);

  // 動画の在りか (後から差し替えられても追従する)
  useEffect(() => {
    if (!roomId || !accessKey) return;
    setPlaybackId(null);
    setShares([]);
    attachingPlaybackRef.current = false;
    return subscribeRushAccess(roomId, accessKey, (access) => {
      if (!access) return;
      setVideoPath(access.videoPath ?? null);
      // 動画の URL は Cloud Functions から受け取るので、ここでは名前とサムネイルだけ入れる
      setRushVideoMeta(access.videoName, access.thumbnails || []);
      setPlaybackId(access.playbackId ?? null);
      setShares(access.shares ?? []);

      // 同期の仕組みより前に作られたルームには再生状態の文書が無い。オペレーターが開いたときに作る
      if (!access.playbackId && usePaintStore.getState().isHost && !attachingPlaybackRef.current) {
        attachingPlaybackRef.current = true;
        void attachRushPlaybackInDB(roomId, accessKey).catch((err) => {
          console.error('Failed to attach rush playback:', err);
          attachingPlaybackRef.current = false;
        });
      }
    });
  }, [roomId, accessKey, setRushVideo]);

  /**
   * 動画の URL を Cloud Functions から受け取り、署名が切れる前に取り直す。
   * ⚠️ 期限付きなので保存しないこと。ここだけで持ち回る。
   */
  useEffect(() => {
    if (!roomId || !accessKey || !videoPath) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const { videoUrl: url, expiresAt } = await getRushRoomVideoUrl(roomId, accessKey);
        if (cancelled) return;
        setVideoError(null);

        /**
         * ⚠️ URL を入れ替えると <video> は頭へ戻る。位置と再生状態を控えて戻すこと。
         * 同期がすぐ直すとはいえ、映像が一瞬 0 秒へ飛ぶのが見えてしまう。
         */
        const video = videoRef.current;
        const resumeAt = video?.currentTime ?? 0;
        const wasPlaying = video ? !video.paused : false;
        usePaintStore.getState().setRushVideo(url, usePaintStore.getState().videoName, undefined);
        if (video && resumeAt > 0) {
          const restore = () => {
            video.removeEventListener('loadedmetadata', restore);
            video.currentTime = resumeAt;
            if (wasPlaying) void video.play().catch(() => undefined);
          };
          video.addEventListener('loadedmetadata', restore);
        }

        // 署名が切れる 5 分前に取り直す
        timer = setTimeout(load, Math.max(5000, expiresAt - Date.now() - 5 * 60 * 1000));
      } catch (err) {
        console.error('Failed to get rush video url:', err);
        if (cancelled) return;
        setVideoError(describeFunctionError(err));
        timer = setTimeout(load, 60 * 1000);
      }
    };
    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, accessKey, videoPath]);

  /**
   * 自分がこのルームにいることを知らせ、一覧を購読する。
   * ⚠️ 画面を閉じたら消すこと。残ると「いない人」が参加者に並び続ける
   * (最後の合図から 75 秒で離席扱いにはなる)。
   */
  useEffect(() => {
    if (!roomId || !accessKey || !user?.email) return;
    // ⚠️ 毎回新しい札を作らないこと。開き直すたびに同じ人が並ぶ
    const participantId = stablePresenceId(`kingfisher_rush_participant_${roomId}`);
    participantIdRef.current = participantId;
    const who = {
      email: user.email,
      name: user.displayName || user.email,
      isOperator: usePaintStore.getState().isHost,
    };
    void joinRushParticipantInDB(roomId, accessKey, participantId, who).catch((err) =>
      console.error('Failed to join rush participants:', err)
    );

    const beat = setInterval(() => {
      void heartbeatRushParticipantInDB(roomId, accessKey, participantId, usePaintStore.getState().isHost).catch(
        (err) => console.warn('Failed to send participant heartbeat:', err)
      );
    }, 30 * 1000);

    const leave = () => void leaveRushParticipantInDB(roomId, accessKey, participantId).catch(() => undefined);
    window.addEventListener('pagehide', leave);

    const unsubscribe = subscribeRushParticipants(roomId, accessKey, (list) => {
      setParticipants(list);
      // ずっと前に閉じた人の記録は、気づいた人が片づける
      for (const p of list) {
        if (Date.now() - p.lastSeenAt > PRESENCE_STALE_MS) {
          void leaveRushParticipantInDB(roomId, accessKey, p.id).catch(() => undefined);
        }
      }
    });
    return () => {
      clearInterval(beat);
      window.removeEventListener('pagehide', leave);
      unsubscribe();
      leave();
    };
  }, [roomId, accessKey, user?.email, user?.displayName]);

  /**
   * 社外の視聴者 (共有ごと)。
   * 期限や停止は共有の文書が持つので、ここでは絞らずに全部を見る。
   * 表示は在席 (最後の合図) で絞るため、終わった共有の人は自然に消える。
   */
  useEffect(() => {
    if (!isHost || shares.length === 0) {
      setGuestViewers({});
      return;
    }
    const stops = shares.map((entry) =>
      subscribeRushShareViewers(entry.shareId, (list) =>
        setGuestViewers((prev) => ({ ...prev, [entry.shareId]: list }))
      )
    );
    return () => stops.forEach((stop) => stop());
  }, [isHost, shares]);

  // 在席の表示 (「視聴中」かどうか) を進める
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20 * 1000);
    return () => clearInterval(timer);
  }, []);

  // リテイク指示 (オペレーター同士で共有し、退室しても残る)
  useEffect(() => {
    if (!roomId || !accessKey) return;
    return subscribeRushRetakes(roomId, accessKey, updateRushRetakes);
  }, [roomId, accessKey, updateRushRetakes]);

  // オペレーター追加
  const handleAddOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = normalizeEmail(newOpEmail);
    if (!trimmed || !roomId) return;

    if (!isAjiadoDomain(trimmed)) {
      alert('@ajiado.co.jp のメールアドレスを指定してください');
      return;
    }

    if (operatorEmails.map(normalizeEmail).includes(trimmed)) {
      setNewOpEmail('');
      return;
    }

    const previous = operatorEmails;
    setOperatorEmails([...previous, trimmed]);
    setNewOpEmail('');
    try {
      await updateRushRoomOperatorsInDB(roomId, [...previous, trimmed]);
    } catch (err) {
      console.error('Failed to add rush operator:', err);
      setOperatorEmails(previous);
      alert('オペレーターを追加できませんでした。通信状態と権限を確認してください。');
    }
  };

  // オペレーター権限解除
  const handleRemoveOperator = async (emailToRemove: string) => {
    if (!roomId) return;
    const previous = operatorEmails;
    const next = previous.filter((e) => normalizeEmail(e) !== normalizeEmail(emailToRemove));
    setOperatorEmails(next);
    try {
      await updateRushRoomOperatorsInDB(roomId, next);
    } catch (err) {
      console.error('Failed to remove rush operator:', err);
      setOperatorEmails(previous);
      alert('オペレーター権限を解除できませんでした。通信状態と権限を確認してください。');
    }
  };

  // 配信の開始 / 停止 (参加者の LIVE 表示はルームの文書から同期される)
  const handleToggleLive = async () => {
    if (!roomId) return;
    const nextLive = !isLive;
    setRushLive(nextLive);
    try {
      // 配信中かはルームの文書だけが持つ (視聴者にはその購読から伝わる)
      await updateRushRoomStatusInDB(roomId, { isLive: nextLive });
    } catch (err) {
      console.error('Failed to update rush live status:', err);
      setRushLive(!nextLive);
      alert('配信状態を切り替えられませんでした。通信状態と権限を確認してください。');
    }
  };

  // 退室。配信中のオペレーターが抜けるなら LIVE を落としておく (一覧に LIVE が残り続けないように)
  const handleLeave = () => {
    if (roomId && isHost && isLive) {
      void updateRushRoomStatusInDB(roomId, { isLive: false }).catch((err) =>
        console.error('Failed to clear rush live status on leave:', err)
      );
    }
    leaveRushRoom();
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
    if (!roomId) return;
    // ⚠️ これは社内向け。社外の人には「外部共有」タブの /watch/... を渡すこと
    const inviteText = [
      '[Kingfisher ラッシュ案内 / 社内向け]',
      `ルーム名: ${roomName}`,
      `ルームID: ${roomId}`,
      `パスワード: ${roomPassword}`,
      `URL: ${buildRushInviteUrl(window.location.origin, roomId)}`,
      '※ @ajiado.co.jp のアカウントでのログインが必要です。',
      '※ 社外の方へは、この案内ではなく「外部共有」で発行した視聴 URL をお渡しください。',
    ].join('\n');
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

  // 再生制御。手元の映像を直接動かさず、ルーム全体の再生状態を書き換える
  const togglePlay = () => playback.controls.toggle();

  const stepFrame = (frames: number) => playback.controls.step(frames);

  const handleSeek = (newTime: number) => playback.controls.seek(newTime);

  // どこをクリックしたかを覚えておく (並べて表示しているとき、キーをこの面へ向けるかの判断)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const container = playerContainerRef.current;
      isPointerInsideRef.current = !!container && e.target instanceof Node && container.contains(e.target);
    };
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => window.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, []);

  // キーボードショートカット (オペレーター専用)
  //
  // ⚠️ 一面表示のとき、または最後にこの面の中をクリックしたときだけ受け取る。
  // 以前は常に window で受けていたため、Win A などと並べると Space や ← → が
  // ペイント側のショートカット (PDF のページ送りなど) と二重に動いていた。
  // 受け取ったキーは捕捉段階で止め、他のショートカットへ流さない。
  useEffect(() => {
    if (!isHost) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isMaximized && !isPointerInsideRef.current) return;

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

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      let handled = true;
      if (e.code === 'Space') {
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        stepFrame(e.shiftKey ? -10 : -1);
      } else if (e.code === 'ArrowRight') {
        stepFrame(e.shiftKey ? 10 : 1);
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isHost, isMaximized, isPlaying, duration, currentTime, fps]);

  // リテイクメモ追加
  const handleAddRetake = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !roomId || !accessKey) return;

    const tc = formatTC(currentTime);
    const newItem: RetakeItem = {
      id: `rtk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timecode: tc,
      frame: currentFrame,
      tag: selectedTag,
      text: inputText.trim(),
    };

    setInputText('');
    try {
      // 画面へは購読経由で即座に反映される (Firestore の書き込みは手元に先に届く)
      await addRushRetakeInDB(roomId, accessKey, newItem, user?.email || '');
    } catch (err) {
      console.error('Failed to add rush retake:', err);
      setInputText(newItem.text);
      alert('リテイク指示を保存できませんでした。通信状態と権限を確認してください。');
    }
  };

  const handleDeleteRetake = async (id: string) => {
    if (!roomId || !accessKey) return;
    try {
      await deleteRushRetakeInDB(roomId, accessKey, id);
    } catch (err) {
      console.error('Failed to delete rush retake:', err);
      alert('リテイク指示を削除できませんでした。通信状態と権限を確認してください。');
    }
  };

  const handleSeekToRetake = (item: RetakeItem) => {
    if (fps > 0) playback.controls.seek((item.frame + 0.5) / fps);
  };

  if (!roomId) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-slate-950 text-slate-100 p-6 select-none">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
          <Video className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold mb-2">ラッシュ専用セッション</h2>
        <p className="text-xs text-slate-400 max-w-sm text-center mb-6 leading-relaxed">
          クラウドに置いた映像を、参加者全員で同じ位置・同じタイミングで見るためのルームです。
          オペレーターの再生・停止・コマ送りに、社内の視聴者も社外の視聴者も合わせて動きます。
          音声のやり取りはありません (Meet などを併用してください)。
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

  // 一覧に出すのは、最近まで居た人だけ (古い記録で埋めない)
  const listedParticipants = participants.filter((p) => isPresenceVisible(p.lastSeenAt, now));
  const listedGuests = Object.values(guestViewers)
    .flat()
    .filter((v) => isPresenceVisible(v.lastSeenAt, now))
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const onlineParticipants = listedParticipants.filter((p) => isViewerOnline(p.lastSeenAt, now));
  const onlineGuests = listedGuests.filter((v) => isViewerOnline(v.lastSeenAt, now));
  const participantCount = onlineParticipants.length + onlineGuests.length;

  /**
   * 同期の状態。
   * ⚠️ 「連動していない」の切り分けは、まずここを見ること。再生状態の文書に繋がっていない画面は、
   * 自分の映像だけを動かしてしまう (古い版を掴んでいる / 権限が無い / 通信が切れている)。
   */
  const syncTone: 'ok' | 'warn' | 'error' = playback.error ? 'error' : playbackId && playback.state ? 'ok' : 'warn';
  const syncLabel = syncTone === 'ok' ? '同期' : syncTone === 'warn' ? '同期 準備中' : '同期 エラー';
  const syncTitle = playback.error
    ? playback.error
    : syncTone === 'ok'
      ? `ルーム全員と同じ再生位置です (${isHost ? 'この画面から操作できます' : '視聴のみ'})`
      : '再生状態にまだ繋がっていません。この画面の再生は他の人と揃いません';

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
          {/* 同期の状態。ここが緑でなければ、その画面は全員の再生に従っていない */}
          <span
            title={`${syncTitle}
${describeBuild(readBuildEnv())}`}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${
              syncTone === 'ok'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : syncTone === 'warn'
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-red-500/15 text-red-300 border-red-500/40'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${syncTone === 'ok' ? 'bg-emerald-400' : syncTone === 'warn' ? 'bg-amber-400' : 'bg-red-400'}`} />
            <span>{syncLabel}</span>
          </span>

          {/* LIVE バッジ */}
          {isLive && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-600 text-white font-bold text-[10px] animate-pulse">
              <Radio className="w-3 h-3" />
              <span>LIVE</span>
            </span>
          )}

          {/* 配信切替 (ホストのみ) */}
          {isHost && (
            <button
              onClick={() => void handleToggleLive()}
              className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition-colors ${
                isLive
                  ? 'bg-red-600/20 text-red-300 border border-red-500/40 hover:bg-red-600/30'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>{isLive ? '配信停止' : '配信開始'}</span>
            </button>
          )}

          {/* 共有するポインターの色と大きさ (オペレーターのみ) */}
          {isHost && (
            <div className="relative">
              <button
                onClick={() => setPointerPanelOpen((open) => !open)}
                title="共有ポインターの色と大きさ"
                className={`p-1.5 rounded border transition-colors ${
                  pointerPanelOpen
                    ? 'border-white/30 bg-white/10 text-white'
                    : 'border-white/10 bg-slate-950 text-slate-300 hover:text-white'
                }`}
              >
                {isDrawing ? (
                  <Pencil className="w-3.5 h-3.5" style={{ color: pointerColor }} />
                ) : (
                  <MousePointer2 className="w-3.5 h-3.5" style={{ color: pointerColor }} />
                )}
              </button>

              {pointerPanelOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-56 p-3 rounded-lg bg-slate-900 border border-white/15 shadow-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-300">共有ポインター</span>
                    <span
                      className="rounded-full"
                      style={{
                        width: pointerSize,
                        height: pointerSize,
                        background: `radial-gradient(circle at 50% 50%, ${withAlpha(pointerColor, 1)} 0%, ${withAlpha(
                          pointerColor,
                          0.95
                        )} ${pointerGlow(pointerSize, pointerBlur).core}%, ${withAlpha(pointerColor, 0)} 100%)`,
                        boxShadow: `0 0 ${pointerGlow(pointerSize, pointerBlur).blurPx}px ${pointerGlow(pointerSize, pointerBlur).spread}px ${withAlpha(pointerColor, 0.55)}`,
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {POINTER_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setPointerColor(c.value)}
                        title={c.label}
                        className={`w-6 h-6 rounded-full border-2 transition-transform ${
                          pointerColor === c.value ? 'border-white scale-110' : 'border-white/20 hover:border-white/50'
                        }`}
                        style={{ background: c.value }}
                      />
                    ))}
                  </div>

                  <label className="block">
                    <span className="text-[10px] text-slate-400">ポインターの大きさ ({pointerSize}px)</span>
                    <input
                      type="range"
                      min={MIN_POINTER_SIZE}
                      max={MAX_POINTER_SIZE}
                      value={pointerSize}
                      onChange={(e) => setPointerSize(clampPointerSize(Number(e.target.value)))}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      className="w-full accent-amber-400"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] text-slate-400">
                      ぼかし ({Math.round(pointerBlur * 100)}%)
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(pointerBlur * 100)}
                      onChange={(e) => setPointerBlur(clampPointerBlur(Number(e.target.value) / 100))}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      className="w-full accent-amber-400"
                    />
                  </label>

                  <div className="pt-2 border-t border-white/10 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setIsDrawing((on) => !on)}
                        className={`flex-1 py-1 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors ${
                          isDrawing
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-white/10 hover:bg-white/20 text-slate-200'
                        }`}
                      >
                        <Pencil className="w-3 h-3" />
                        {isDrawing ? '描画中 (切る)' : '描画する'}
                      </button>
                      <button
                        onClick={() => clearStrokesRef.current?.()}
                        title="自分が描いた線を今すぐ消す"
                        className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-slate-200 text-[10px] font-bold flex items-center gap-1"
                      >
                        <Eraser className="w-3 h-3" />
                        消す
                      </button>
                    </div>

                    <label className="block">
                      <span className="text-[10px] text-slate-400">線の太さ ({strokeSize}px)</span>
                      <input
                        type="range"
                        min={MIN_STROKE_SIZE}
                        max={MAX_STROKE_SIZE}
                        value={strokeSize}
                        onChange={(e) => setStrokeSize(clampStrokeSize(Number(e.target.value)))}
                        onPointerUp={(e) => e.currentTarget.blur()}
                        className="w-full accent-amber-400"
                      />
                    </label>
                  </div>

                  <p className="text-[10px] text-slate-500 leading-normal">
                    映像の上にカーソルを乗せている間だけ、この色で全員に見えます。
                    描画を入にするとドラッグで線を引けます (3 秒で自動的に消えます)。
                  </p>
                </div>
              )}
            </div>
          )}

          {/*
            映像の音のミュート。
            ⚠️ 通話の機能ではない。音声通話は実装していないので、マイクの絵のボタンを置かないこと
            (2026-09-22 に「押しても何もしない」ものとして外した)。
          */}
          <button
            onClick={() => setRushSpeakerMuted(!isSpeakerMuted)}
            title={isSpeakerMuted ? '映像の音を出す' : '映像の音をミュート'}
            className={`p-1.5 rounded border border-white/10 bg-slate-950 transition-colors ${
              isSpeakerMuted ? 'text-red-400' : 'text-slate-300 hover:text-white'
            }`}
          >
            {isSpeakerMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* 招待コピー (ホストのみ) */}
          {isHost && (
            <button
              onClick={handleCopyInvite}
              title="社内向けの招待をコピー (ログインが必要。社外の方へは「外部共有」タブの視聴 URL を渡してください)"
              className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-200 transition-colors flex items-center gap-1"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
              <span className="text-[10px] font-bold">社内招待</span>
            </button>
          )}

          {/* 退室 */}
          <button
            onClick={handleLeave}
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
          <div
            ref={videoAreaRef}
            className={`flex-1 flex items-center justify-center relative overflow-hidden group w-full h-full ${
              isHost && videoUrl ? (isDrawing ? 'cursor-crosshair' : 'cursor-none') : ''
            }`}
          >
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
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

            {/* 配信で共有する赤いポインター。オペレーターが映像の上にいる間だけ出る */}
            <RushPointerLayer
              playbackId={playbackId}
              containerRef={videoAreaRef}
              videoRef={videoRef}
              canBroadcast={isHost}
              appearance={pointerProfile}
              pointerId={pointerIdRef.current}
              drawing={isHost && isDrawing}
              onClearRef={clearStrokesRef}
            />

            {/* タイムコード表示 (オペレーター時のみ) */}
            {isHost && (
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded border border-white/10 font-mono text-amber-300 font-bold text-xs tracking-wider">
                {formatTC(currentTime)} <span className="text-slate-400 font-normal">(f:{currentFrame})</span>
              </div>
            )}

            {/* ブラウザに音声付き再生を止められたら、クリックで始めてもらう */}
            {playback.needsGesture && (
              <button
                onClick={playback.unlock}
                className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 text-white"
              >
                <span className="flex items-center gap-2 px-5 py-3 rounded-full bg-amber-500 text-slate-950 font-bold text-sm shadow-2xl">
                  <Play className="w-5 h-5 fill-current" />
                  クリックして視聴を開始
                </span>
              </button>
            )}

            {/* 同期の状態 (オペレーターも同じ再生に合わせている) */}
            {videoUrl && (
              <div className={`absolute ${isHost ? 'top-10' : 'top-3'} left-3 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded border border-white/10 text-[10px] text-slate-300`}>
                {videoError
                  ? videoError
                  : playback.error
                  ? playback.error
                  : !playbackId
                    ? '再生の同期を準備しています'
                    : isHost
                      ? playback.state?.playing
                        ? 'ルーム全員と同じ再生位置です (再生中)'
                        : 'ルーム全員と同じ再生位置です (停止中)'
                      : playback.state?.playing
                        ? 'オペレーターの再生に合わせています'
                        : 'オペレーターが一時停止中'}
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
              thumbnails={thumbnails}
              currentTime={currentTime}
              duration={duration}
              fps={fps}
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
                <span>参加者 ({participantCount || 1})</span>
              </button>
              <button
                onClick={() => setSideTab('share')}
                className={`flex-1 py-2 text-[11px] font-bold flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  sideTab === 'share'
                    ? 'border-sky-400 text-sky-300 bg-sky-400/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>外部共有</span>
              </button>
            </div>

            {/* タブコンテンツ */}
            {sideTab === 'retakes' && (
              <div className="flex-1 flex flex-col p-2 min-h-0">
                {/* 入力フォーム */}
                <form onSubmit={(e) => void handleAddRetake(e)} className="space-y-1.5 pb-2 border-b border-white/10">
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
                      placeholder="リテイク指示を入力 (オペレーター同士でリアルタイム共有)..."
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
                              void handleDeleteRetake(it.id);
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

                {/* 社内の参加者 */}
                <div>
                  <h4 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-2">
                    社内 ({onlineParticipants.length})
                  </h4>
                  <div className="space-y-1">
                    {listedParticipants.length === 0 && (
                      <p className="text-[10px] text-slate-500">読み込み中...</p>
                    )}
                    {listedParticipants.map((p) => {
                      const online = isViewerOnline(p.lastSeenAt, now);
                      const isMe = p.id === participantIdRef.current;
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-2 p-2 rounded bg-white/5 border border-white/5"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                            <span className="text-xs truncate">
                              {p.name}
                              {isMe && <span className="text-slate-500"> (自分)</span>}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                              p.isOperator ? 'text-amber-400 bg-amber-400/10' : 'text-indigo-300 bg-indigo-400/10'
                            }`}
                          >
                            {p.isOperator ? 'OPERATOR' : '視聴'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 社外の視聴者 (外部共有の URL から入った人) */}
                {isHost && (
                  <div>
                    <h4 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-2">
                      社外 ({onlineGuests.length})
                    </h4>
                    {listedGuests.length === 0 ? (
                      <p className="text-[10px] text-slate-500">
                        まだ誰も入っていません (「外部共有」タブで視聴 URL を発行できます)
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {listedGuests.map((v) => {
                            const online = isViewerOnline(v.lastSeenAt, now);
                            return (
                              <div
                                key={v.id}
                                className="flex items-center justify-between gap-2 p-2 rounded bg-white/5 border border-white/5"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                  <span className="text-xs truncate">{v.name}</span>
                                </div>
                                <span className="text-[10px] font-bold text-emerald-300 bg-emerald-400/10 px-1.5 py-0.5 rounded flex-shrink-0">
                                  社外
                                </span>
                              </div>
                            );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {sideTab === 'share' && roomId && accessKey && (
              <RushSharePanel
                roomId={roomId}
                roomName={roomName}
                roomAccessKey={accessKey}
                videoPath={videoPath}
                playbackId={playbackId}
                shares={shares}
                userEmail={user?.email || ''}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
