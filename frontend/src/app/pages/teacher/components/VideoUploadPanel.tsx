import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import HlsVideoPlayer from '@/components/HlsVideoPlayer';
import { useVideoAsset, useVideoUpload } from '@/hooks/media-hooks';

/**
 * Teacher-side upload + preview for an uploaded (HLS) course video.
 *
 * The file goes straight from the browser to cloud storage; ViBe only issues the
 * signed link, so a multi-GB upload never occupies a backend request. After the
 * upload lands, an external pipeline transcodes it — that takes minutes, so the
 * panel polls and shows progress rather than blocking the form.
 *
 * This preview is also the only place HlsVideoPlayer is used in phase 1. The
 * learner flow deliberately does not play uploaded video yet, because
 * watch-time, proctoring and progression are still wired only to the YouTube
 * player (see Item-container.tsx).
 */
export interface VideoUploadPanelProps {
    courseId: string;
    courseVersionId: string;
    /** Currently attached asset, if any. */
    assetId?: string;
    /** Called with the new asset id once an upload finishes. */
    onAssetChange: (assetId: string | undefined) => void;
    /** Segment bounds, so the preview matches what a learner would see. */
    startTime?: string;
    endTime?: string;
}

export default function VideoUploadPanel({
    courseId,
    courseVersionId,
    assetId,
    onAssetChange,
    startTime,
    endTime,
}: VideoUploadPanelProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { upload, cancel, reset, phase, progress, error } = useVideoUpload();

    // Polling stops on its own once the asset is READY or FAILED.
    const { data: asset, isLoading: isCheckingStatus } = useVideoAsset(assetId);

    const handlePick = async (file?: File | null) => {
        if (!file) return;
        const result = await upload(file, { courseId, courseVersionId });
        if (result) onAssetChange(result.assetId);
    };

    const handleRemove = () => {
        reset();
        onAssetChange(undefined);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const isUploading = phase === 'requesting' || phase === 'uploading' || phase === 'finalizing';

    return (
        <div className="space-y-3">
            <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-msvideo"
                className="hidden"
                onChange={event => void handlePick(event.target.files?.[0])}
            />

            {!assetId && !isUploading && (
                <div className="rounded-md border border-dashed p-6 text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">Upload a video</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        MP4, MOV, MKV, WebM or AVI. The file uploads directly to
                        storage, then takes a few minutes to process.
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        className="mt-3"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Choose file
                    </Button>
                </div>
            )}

            {isUploading && (
                <div className="rounded-md border p-4">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {phase === 'requesting' && 'Preparing upload…'}
                            {phase === 'uploading' && `Uploading… ${progress}%`}
                            {phase === 'finalizing' && 'Finishing up…'}
                        </span>
                        {phase === 'uploading' && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={cancel}
                            >
                                <X className="mr-1 h-3 w-3" />
                                Cancel
                            </Button>
                        )}
                    </div>
                    <Progress value={progress} className="mt-3" />
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
                    <div className="flex-1">
                        <p className="text-sm text-destructive">{error}</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Try again
                        </Button>
                    </div>
                </div>
            )}

            {assetId && !isUploading && (
                <div className="rounded-md border p-4">
                    <div className="flex items-center justify-between">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {asset?.originalFileName ?? 'Uploaded video'}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {isCheckingStatus && 'Checking status…'}
                                {asset?.status === 'UPLOADING' &&
                                    'Waiting for the upload to be confirmed…'}
                                {asset?.status === 'PROCESSING' &&
                                    'Processing video — this can take a few minutes.'}
                                {asset?.status === 'READY' && 'Ready to play'}
                                {asset?.status === 'FAILED' &&
                                    (asset.failureReason ?? 'Processing failed.')}
                            </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            {asset?.status === 'PROCESSING' && (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {asset?.status === 'READY' && (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                            )}
                            {asset?.status === 'FAILED' && (
                                <AlertCircle className="h-4 w-4 text-destructive" />
                            )}
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleRemove}
                            >
                                Replace
                            </Button>
                        </div>
                    </div>

                    {asset?.playable && (
                        <div className="mt-3">
                            <HlsVideoPlayer
                                assetId={assetId}
                                startTime={startTime}
                                endTime={endTime}
                                className="aspect-video w-full"
                            />
                            <p className="mt-2 text-xs text-muted-foreground">
                                Preview only. Uploaded video is not yet enabled for
                                learners — watch-time and proctoring still need to be
                                connected to this player.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
