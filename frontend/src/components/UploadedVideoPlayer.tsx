import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import HlsVideoPlayer from './HlsVideoPlayer';
import { useVideoProgressTracking } from '@/hooks/use-video-progress-tracking';

/**
 * The learner-facing player for uploaded (HLS) video.
 *
 * Composes HlsVideoPlayer with watch-time and completion tracking, so an
 * uploaded lesson records progress and can be completed — the two things whose
 * absence previously made it unsafe to show learners at all.
 *
 * ⚠️ Still NOT connected: proctoring, anomaly capture, face/gesture detection and
 * seek gating. Those remain wired only to the YouTube player. A course that
 * relies on proctoring should therefore not use uploaded video yet, and the
 * caller is responsible for that decision — this component does not enforce it.
 */
export interface UploadedVideoPlayerProps {
    assetId: string;
    startTime?: string;
    endTime?: string;
    onNext?: () => void;
    isProgressUpdating?: boolean;
    isCompleted?: boolean;
    isAlreadyWatched?: boolean;
    completedItemIdsRef?: React.RefObject<Set<string>>;
    nextItemId?: string;
    seekForwardEnabled?: boolean;
}

export default function UploadedVideoPlayer({
    assetId,
    startTime,
    endTime,
    onNext,
    isProgressUpdating,
    isCompleted,
    isAlreadyWatched,
    completedItemIdsRef,
    nextItemId,
    seekForwardEnabled,
}: UploadedVideoPlayerProps) {
    const [finished, setFinished] = useState(false);

    const { handlePlay, handlePause, handleEnded, isStopping } =
        useVideoProgressTracking({
            enabled: true,
            isCompleted,
            isAlreadyWatched,
            completedItemIdsRef,
            nextItemId,
            seekForwardEnabled,
        });

    /**
     * Only reveal "next" once the server has actually accepted the completion.
     * Advancing on the video's `ended` event alone would let a learner move past
     * an item the server still considers unwatched.
     */
    const onVideoEnded = useCallback(async () => {
        const completed = await handleEnded();
        setFinished(true);
        if (!completed && !isCompleted && !isAlreadyWatched) {
            toast.warning(
                'We could not record this lesson as complete. Please watch it fully and try again.',
            );
        }
    }, [handleEnded, isCompleted, isAlreadyWatched]);

    const canContinue = finished || isCompleted || isAlreadyWatched;

    return (
        <div className="flex h-full w-full flex-col">
            <HlsVideoPlayer
                assetId={assetId}
                startTime={startTime}
                endTime={endTime}
                className="min-h-0 flex-1"
                onPlay={handlePlay}
                onPause={handlePause}
                onEnded={onVideoEnded}
            />

            <div className="mt-3 flex items-center justify-end gap-3">
                {isStopping && (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving your progress…
                    </span>
                )}
                {canContinue && onNext && (
                    <button
                        type="button"
                        onClick={onNext}
                        disabled={isProgressUpdating || isStopping}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium
                            text-primary-foreground disabled:opacity-50"
                    >
                        {isProgressUpdating ? 'Loading…' : 'Next'}
                    </button>
                )}
            </div>
        </div>
    );
}
