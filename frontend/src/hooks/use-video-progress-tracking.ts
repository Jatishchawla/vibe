import { useCallback, useEffect, useRef, useState } from 'react';
import { useCourseStore } from '@/store/course-store';
import { useStartItem, useStopItem, useUpsertWatchTime } from '@/hooks/hooks';

/** How often a watching learner is reported as still present. */
const WATCH_PING_MS = 15000;

/**
 * Watch-time and completion tracking for a video item, independent of which
 * player renders it.
 *
 * This mirrors the lifecycle components/video.tsx runs for YouTube video:
 *
 *   play      -> startItem            (server opens a watch record)
 *   watching  -> upsertWatchTime/15s  (keeps it alive)
 *   finished  -> stopItem             (server marks the item complete)
 *
 * It is a separate hook rather than an edit to video.tsx on purpose: that
 * component is the critical path for every existing course, and duplicating the
 * three calls here is a smaller risk than restructuring it.
 *
 * NOT included: proctoring, anomaly capture, seek gating. Those remain
 * YouTube-only for now, so a caller using this hook must not present the video
 * as proctored.
 */
export function useVideoProgressTracking(options: {
  /** Skip tracking entirely — e.g. an instructor previewing their own upload. */
  enabled: boolean;
  /** Already finished, so starting a new watch record would be wrong. */
  isCompleted?: boolean;
  isAlreadyWatched?: boolean;
  /** Shared set of items completed this session, owned by the learn page. */
  completedItemIdsRef?: React.RefObject<Set<string>>;
  /** Passed to the server so it knows where the learner goes next. */
  nextItemId?: string;
  seekForwardEnabled?: boolean;
}) {
  const {
    enabled,
    isCompleted,
    isAlreadyWatched,
    completedItemIdsRef,
    nextItemId,
    seekForwardEnabled,
  } = options;

  const { currentCourse, setWatchItemId } = useCourseStore();
  const startItem = useStartItem();
  const stopItem = useStopItem();
  const upsertWatchTime = useUpsertWatchTime();

  const [isPlaying, setIsPlaying] = useState(false);
  const watchItemIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const stoppedRef = useRef(false);

  /**
   * Whether this item still needs tracking. An item already finished — in this
   * session or a previous one — must not open a second watch record.
   */
  const shouldTrack = useCallback(() => {
    if (!enabled || !currentCourse?.itemId) return false;
    if (isCompleted || isAlreadyWatched) return false;
    if (completedItemIdsRef?.current?.has(currentCourse.itemId)) return false;
    return true;
  }, [enabled, currentCourse?.itemId, isCompleted, isAlreadyWatched, completedItemIdsRef]);

  /** Call when playback starts. Safe to call repeatedly; only the first counts. */
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    if (startedRef.current || !shouldTrack() || !currentCourse) return;
    startedRef.current = true;

    startItem.mutate({
      params: {
        path: {
          courseId: currentCourse.courseId,
          courseVersionId: currentCourse.versionId ?? '',
        },
      },
      body: {
        itemId: currentCourse.itemId,
        moduleId: currentCourse.moduleId ?? '',
        sectionId: currentCourse.sectionId ?? '',
        cohortId: currentCourse.cohortId || undefined,
      },
    } as never);
  }, [shouldTrack, currentCourse, startItem]);

  const handlePause = useCallback(() => setIsPlaying(false), []);

  // Keep the server's copy of the watch id, so a reload can resume it.
  useEffect(() => {
    const id = (startItem.data as {watchItemId?: string} | undefined)?.watchItemId;
    if (id) {
      watchItemIdRef.current = id;
      setWatchItemId(id);
    }
  }, [startItem.data, setWatchItemId]);

  // Heartbeat while actually playing. Pausing stops it, which is what makes the
  // recorded time reflect watching rather than merely having the page open.
  useEffect(() => {
    const watchItemId = watchItemIdRef.current || currentCourse?.watchItemId;
    if (!watchItemId || !isPlaying || !shouldTrack()) return;

    const interval = setInterval(() => {
      upsertWatchTime.mutate({
        body: {
          watchItemId,
          itemId: currentCourse?.itemId,
          cohortId: currentCourse?.cohortId || undefined,
        },
      } as never);
    }, WATCH_PING_MS);

    return () => clearInterval(interval);
  }, [isPlaying, currentCourse?.watchItemId, currentCourse?.itemId, shouldTrack, upsertWatchTime]);

  /**
   * Call when the video reaches its end. Marks the item complete server-side.
   *
   * Resolves false when the server refuses — most often because too little of the
   * video was watched — so the caller can keep the learner on the item instead of
   * advancing them past something they skipped.
   */
  const handleEnded = useCallback(async (): Promise<boolean> => {
    setIsPlaying(false);
    const watchItemId = watchItemIdRef.current || currentCourse?.watchItemId;

    if (stoppedRef.current || !watchItemId || !shouldTrack() || !currentCourse) {
      return false;
    }
    stoppedRef.current = true;

    try {
      await stopItem.mutateAsync({
        params: {
          path: {
            courseId: currentCourse.courseId,
            courseVersionId: currentCourse.versionId ?? '',
          },
        },
        body: {
          watchItemId,
          itemId: currentCourse.itemId ?? '',
          moduleId: currentCourse.moduleId ?? '',
          sectionId: currentCourse.sectionId ?? '',
          seekForwardEnabled,
          nextItemId,
          cohortId: currentCourse.cohortId || undefined,
        },
      } as never);

      if (currentCourse.itemId) {
        completedItemIdsRef?.current?.add(currentCourse.itemId);
      }
      return true;
    } catch (error) {
      // Allow a retry: the learner may genuinely have watched enough and hit a
      // transient failure, and latching this closed would strand them.
      stoppedRef.current = false;
      console.error('[useVideoProgressTracking] stopItem failed:', error);
      return false;
    }
  }, [currentCourse, shouldTrack, stopItem, seekForwardEnabled, nextItemId, completedItemIdsRef]);

  return {
    handlePlay,
    handlePause,
    handleEnded,
    isStopping: stopItem.isPending,
    stopError: stopItem.error,
  };
}
