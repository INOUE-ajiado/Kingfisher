import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeRushPlayback, writeRushPlaybackInDB } from '../engine/rushService';
import {
  commandSeek,
  commandStep,
  commandToggle,
  expectedPosition,
  PlaybackState,
  shouldResync,
} from '../engine/rushPlaybackSync';

export interface RushPlaybackControls {
  /** 再生 / 一時停止 */
  toggle: () => void;
  /** 位置を動かす (再生中かどうかは変えない) */
  seek: (position: number) => void;
  /** コマ送り (送ったら止まる) */
  step: (frames: number) => void;
  /** 配信中 (LIVE) の切り替え */
  setLive: (live: boolean) => void;
}

export interface RushSharedPlayback {
  state: PlaybackState | null;
  needsGesture: boolean;
  unlock: () => void;
  error: string | null;
  controls: RushPlaybackControls;
}

/**
 * ラッシュの再生を全員で揃える。
 *
 * 見ている人は全員 (社外の視聴者・社内の一般画面・オペレーター自身) この状態に追従する。
 * canControl が true の人 (オペレーター) だけが controls で状態を書き換えられる。
 *
 * ⚠️ オペレーターも追従側に含めること。自分の <video> を直接動かして済ませると、
 * オペレーターが 2 人いたときに別々のところを再生してしまう。
 * ⚠️ <video> に autoPlay を付けないこと。開いただけで再生が始まり、全員の再生に割り込む。
 */
export function useRushSharedPlayback(params: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  playbackId: string | null;
  fps: number;
  canControl: boolean;
}): RushSharedPlayback {
  const { videoRef, videoUrl, playbackId, fps, canControl } = params;
  const [state, setState] = useState<PlaybackState | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRef = useRef<{ state: PlaybackState; receivedAt: number } | null>(null);

  /** 手元の <video> を、いるべき位置・再生状態へ合わせる */
  const apply = useCallback(() => {
    const video = videoRef.current;
    const latest = latestRef.current;
    if (!video || !latest || video.readyState < 1) return;

    const expected = expectedPosition(latest.state, latest.receivedAt, Date.now(), video.duration);
    if (shouldResync(video.currentTime, expected, latest.state.playing, fps)) {
      video.currentTime = expected;
    }
    if (latest.state.playing && video.paused && !(video.duration > 0 && expected >= video.duration)) {
      video.play().then(
        () => setNeedsGesture(false),
        (err: DOMException) => {
          if (err?.name === 'NotAllowedError') setNeedsGesture(true);
        }
      );
    } else if (!latest.state.playing && !video.paused) {
      video.pause();
    }
  }, [videoRef, fps]);

  /** 手元に先に反映してから書く (押した感じを待たせない)。書けたら全員へ届く */
  const publish = useCallback(
    (next: PlaybackState) => {
      latestRef.current = { state: next, receivedAt: Date.now() };
      setState(next);
      apply();
      if (!playbackId) return;
      void writeRushPlaybackInDB(playbackId, next).catch((err) => {
        console.error('Failed to write rush playback:', err);
        setError('再生状態を配れませんでした。通信状態と権限を確認してください。');
      });
    },
    [apply, playbackId]
  );

  useEffect(() => {
    if (!playbackId) return;
    setError(null);
    return subscribeRushPlayback(
      playbackId,
      (next, receivedAt) => {
        latestRef.current = { state: next, receivedAt };
        setState(next);
        apply();
      },
      () => setError('再生状態を受け取れません。通信状態を確認してください。')
    );
  }, [playbackId, apply]);

  // 通信の揺れや読み込みの遅れで外れた分を、1 秒おきに直す
  useEffect(() => {
    if (!playbackId) return;
    const timer = setInterval(apply, 1000);
    const video = videoRef.current;
    video?.addEventListener('loadedmetadata', apply);
    return () => {
      clearInterval(timer);
      video?.removeEventListener('loadedmetadata', apply);
    };
  }, [playbackId, apply, videoRef, videoUrl]);

  const currentFor = useCallback(
    (): { state: PlaybackState; position: number; duration: number } => {
      const video = videoRef.current;
      const base = latestRef.current?.state ?? { playing: false, position: 0, live: false };
      const duration = video?.duration ?? Number.NaN;
      // 今の位置は手元の <video> を正とする (操作した人の画面が基準)
      const position = video ? video.currentTime : base.position;
      return { state: base, position, duration };
    },
    [videoRef]
  );

  const controls: RushPlaybackControls = {
    toggle: useCallback(() => {
      if (!canControl) return;
      const { state: s, position, duration } = currentFor();
      publish(commandToggle(s, position, duration));
    }, [canControl, currentFor, publish]),

    seek: useCallback(
      (position: number) => {
        if (!canControl) return;
        const { state: s, duration } = currentFor();
        publish(commandSeek(s, position, duration));
      },
      [canControl, currentFor, publish]
    ),

    step: useCallback(
      (frames: number) => {
        if (!canControl) return;
        const { state: s, position, duration } = currentFor();
        publish(commandStep(s, position, frames, fps, duration));
      },
      [canControl, currentFor, publish, fps]
    ),

    setLive: useCallback(
      (live: boolean) => {
        if (!canControl) return;
        // ⚠️ 位置は必ず今の値で書き直すこと。古い位置のまま書くと、受け取った側は
        // そこから経過分を足し直すので、全員の再生が巻き戻る
        const { state: s, position } = currentFor();
        publish({ ...s, live, position });
      },
      [canControl, currentFor, publish]
    ),
  };

  const unlock = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // クリックの中で一度再生して、音声付き再生の許可を得る
    video.play().then(
      () => {
        setNeedsGesture(false);
        apply();
      },
      () => setNeedsGesture(true)
    );
  }, [videoRef, apply]);

  return { state, needsGesture, unlock, error, controls };
}
