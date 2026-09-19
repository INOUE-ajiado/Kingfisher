import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeRushPlayback, writeRushPlaybackInDB } from '../engine/rushService';
import {
  expectedPosition,
  HOST_HEARTBEAT_MS,
  PlaybackState,
  shouldResync,
} from '../engine/rushPlaybackSync';

/**
 * ホスト (オペレーター) 側: 手元の <video> の再生・停止・シークを再生状態の文書へ書く。
 *
 * ⚠️ 開いただけでは書かないこと。読み込み直後の「停止・0 秒」を書くと、
 * 他の人が再生している最中にオペレーターが画面を開いただけで全員が止まる。
 * 実際に操作したとき (play / pause / seeked) と、再生中の定期的な位置合わせだけ書く。
 * そのため <video> に autoPlay を付けないこと (自動再生も「操作」として流れてしまう)。
 */
export function useRushPlaybackBroadcaster(params: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  playbackId: string | null;
  enabled: boolean;
  isLive: boolean;
}): void {
  const { videoRef, videoUrl, playbackId, enabled, isLive } = params;
  const liveRef = useRef(isLive);
  liveRef.current = isLive;

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !playbackId || !video) return;

    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastWrite = 0;
    const write = () => {
      lastWrite = Date.now();
      void writeRushPlaybackInDB(playbackId, {
        playing: !video.paused && !video.ended,
        position: video.currentTime,
        live: liveRef.current,
      }).catch((err) => console.error('Failed to write rush playback:', err));
    };
    // スクラブ中は seeked が連続するので、150ms に 1 回へ間引く (最後の 1 回は必ず書く)
    const writeThrottled = () => {
      const wait = 150 - (Date.now() - lastWrite);
      if (wait <= 0) {
        write();
        return;
      }
      if (throttleTimer) clearTimeout(throttleTimer);
      throttleTimer = setTimeout(write, wait);
    };

    const onPlay = () => write();
    const onPause = () => write();
    const onSeeked = () => writeThrottled();
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);

    const heartbeat = setInterval(() => {
      if (!video.paused && !video.ended) write();
    }, HOST_HEARTBEAT_MS);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      clearInterval(heartbeat);
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [videoRef, videoUrl, playbackId, enabled]);
}

/**
 * 視聴者側: 再生状態の文書に <video> を追従させる。
 *
 * ブラウザは操作なしの音声付き再生を止めることがある。止められたら needsGesture が立つので、
 * 画面にボタンを出して unlock() を呼ぶ (クリックの中で play するため許される)。
 */
export function useRushPlaybackFollower(params: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  playbackId: string | null;
  enabled: boolean;
  fps: number;
}): { state: PlaybackState | null; needsGesture: boolean; unlock: () => void; error: string | null } {
  const { videoRef, videoUrl, playbackId, enabled, fps } = params;
  const [state, setState] = useState<PlaybackState | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRef = useRef<{ state: PlaybackState; receivedAt: number } | null>(null);

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

  useEffect(() => {
    if (!enabled || !playbackId) return;
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
  }, [enabled, playbackId, apply]);

  // 通信の揺れや読み込みの遅れで外れた分を、1 秒おきに直す
  useEffect(() => {
    if (!enabled || !playbackId) return;
    const timer = setInterval(apply, 1000);
    const video = videoRef.current;
    video?.addEventListener('loadedmetadata', apply);
    return () => {
      clearInterval(timer);
      video?.removeEventListener('loadedmetadata', apply);
    };
  }, [enabled, playbackId, apply, videoRef, videoUrl]);

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

  return { state, needsGesture, unlock, error };
}
