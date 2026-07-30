import Hls from 'hls.js';
import type { YTPlayerInstance } from '@/types/video.types';

/**
 * Player-state values, shared by both players.
 *
 * These are YouTube's own numeric constants, reused deliberately: the HLS player
 * emits the same numbers, so every state check in video.tsx works for both
 * without a translation layer — and without needing `window.YT` to exist at all,
 * which it does not when the lesson is an uploaded video.
 */
export const PLAYER_STATE = {
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
} as const;

export interface HlsPlayerHandle extends YTPlayerInstance {
    destroy: () => void;
    getIframe?: () => HTMLIFrameElement | undefined;
}

/**
 * Builds an HLS-backed player that satisfies the same interface as the YouTube
 * IFrame player.
 *
 * This is what lets uploaded video reuse video.tsx wholesale — proctoring, seek
 * gating, watch-time, overlays and keyboard locks all drive the player through
 * roughly a dozen methods, so matching those method names is enough. The
 * alternative was reimplementing ~2,200 lines of that logic for a second player,
 * which would have drifted out of sync the first time either was fixed.
 *
 * `resolveUrl` is called for each (re)load rather than taking a fixed URL,
 * because playback grants are time-boxed: when one expires mid-lesson hls.js
 * reports a fatal network error, and recovery needs a freshly signed URL.
 */
export function createHlsPlayerInstance(options: {
    container: HTMLElement;
    resolveUrl: () => Promise<string>;
    startSeconds?: number;
    volume?: number;
    events: {
        onReady: (event: { target: HlsPlayerHandle }) => void;
        onStateChange: (event: { data: number; target: HlsPlayerHandle }) => void;
    };
}): HlsPlayerHandle {
    const { container, resolveUrl, startSeconds = 0, volume = 100, events } = options;

    const video = document.createElement('video');
    video.playsInline = true;
    video.controls = false;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.display = 'block';
    video.style.background = '#000';
    video.style.objectFit = 'contain';
    container.replaceChildren(video);

    let hls: Hls | null = null;
    let destroyed = false;
    let readyFired = false;
    let recovering = false;

    const handle: HlsPlayerHandle = {
        playVideo: () => void video.play().catch(() => undefined),
        pauseVideo: () => video.pause(),
        seekTo: (seconds: number) => {
            video.currentTime = seconds;
        },
        getCurrentTime: () => video.currentTime || 0,
        getDuration: () => (Number.isFinite(video.duration) ? video.duration : 0),
        getVolume: () => Math.round(video.volume * 100),
        setVolume: (value: number) => {
            video.volume = Math.min(Math.max(value, 0), 100) / 100;
        },
        getPlaybackRate: () => video.playbackRate,
        setPlaybackRate: (rate: number) => {
            video.playbackRate = rate;
        },
        getAvailablePlaybackRates: () => [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        /**
         * HLS selects quality itself from the bitrate ladder, so the explicit
         * quality controls are inert here rather than absent — video.tsx calls
         * them unconditionally and must not have to know which player it holds.
         */
        getAvailableQualityLevels: () => [],
        setPlaybackQuality: () => undefined,
        loadModule: () => undefined,
        setOption: () => undefined,
        destroy: () => {
            destroyed = true;
            hls?.destroy();
            hls = null;
            video.remove();
        },
    } as HlsPlayerHandle;

    video.addEventListener('play', () =>
        events.onStateChange({ data: PLAYER_STATE.PLAYING, target: handle }),
    );
    video.addEventListener('pause', () => {
        // A pause fired at the very end is the natural end of playback; reporting
        // PAUSED there would suppress the ENDED handling that completes the item.
        if (video.ended) return;
        events.onStateChange({ data: PLAYER_STATE.PAUSED, target: handle });
    });
    video.addEventListener('ended', () =>
        events.onStateChange({ data: PLAYER_STATE.ENDED, target: handle }),
    );

    const fireReadyOnce = () => {
        if (readyFired || destroyed) return;
        readyFired = true;
        handle.setVolume(volume);
        events.onReady({ target: handle });
    };

    async function load(resumeAt?: number) {
        if (destroyed) return;
        const url = await resolveUrl();
        if (destroyed) return;

        if (Hls.isSupported()) {
            hls?.destroy();
            const instance = new Hls({ enableWorker: true });
            hls = instance;

            instance.on(Hls.Events.MANIFEST_PARSED, () => {
                recovering = false;
                const target = resumeAt ?? startSeconds;
                if (target) video.currentTime = target;
                fireReadyOnce();
            });

            instance.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal || destroyed) return;

                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recovering) {
                    // Most likely an expired grant: re-sign and resume from where
                    // the learner actually was, not from the start.
                    recovering = true;
                    void load(video.currentTime);
                    return;
                }
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    instance.recoverMediaError();
                }
            });

            instance.loadSource(url);
            instance.attachMedia(video);
            return;
        }

        // Safari plays HLS natively and does not support hls.js.
        video.src = url;
        const seekOnce = () => {
            const target = resumeAt ?? startSeconds;
            if (target) video.currentTime = target;
            video.removeEventListener('loadedmetadata', seekOnce);
            fireReadyOnce();
        };
        video.addEventListener('loadedmetadata', seekOnce);
    }

    void load();

    return handle;
}
