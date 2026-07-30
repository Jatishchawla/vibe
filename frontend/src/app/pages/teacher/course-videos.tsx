import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import HlsVideoPlayer from '@/components/HlsVideoPlayer';
import { useCourseStore } from '@/store/course-store';
import {
  useDeleteVideoAsset,
  useUpdateVideoAsset,
  useVideoAssets,
  useVideoUpload,
} from '@/hooks/media-hooks';
import type { VideoAsset, VideoAssetStatus } from '@/types/media.types';

/**
 * A course's video library.
 *
 * Lectures are uploaded here once and then referenced by any number of video
 * items, each covering a different time range. That separation is the point:
 * uploading the same recording per segment would pay for a transcode every time.
 *
 * Visible to every instructor on the course version, not only the uploader.
 */
export default function CourseVideosPage() {
  const { currentCourse } = useCourseStore();
  const courseId = currentCourse?.courseId ?? undefined;
  const versionId = currentCourse?.versionId ?? undefined;

  const [search, setSearch] = useState('');
  const [previewAsset, setPreviewAsset] = useState<VideoAsset | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { assets, isLoading } = useVideoAssets(courseId, versionId, { search });
  const { upload, cancel, phase, progress, error } = useVideoUpload();
  const updateAsset = useUpdateVideoAsset();
  const deleteAsset = useDeleteVideoAsset();

  const isUploading =
    phase === 'requesting' || phase === 'uploading' || phase === 'finalizing';

  const processingCount = useMemo(
    () =>
      assets.filter(a => a.status === 'UPLOADING' || a.status === 'PROCESSING')
        .length,
    [assets],
  );

  const handlePick = async (file?: File | null) => {
    if (!file || !courseId || !versionId) return;
    const result = await upload(file, { courseId, courseVersionId: versionId });
    if (result) {
      toast.success('Upload complete — processing has started.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startRename = (asset: VideoAsset) => {
    setRenamingId(asset.assetId);
    setRenameValue(asset.title);
  };

  const commitRename = async (asset: VideoAsset) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title || title === asset.title) return;
    try {
      await updateAsset.mutateAsync({ assetId: asset.assetId, title });
      toast.success('Renamed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed.');
    }
  };

  const handleDelete = async (asset: VideoAsset) => {
    if (
      !window.confirm(
        `Remove "${asset.title}" from the library? Lessons already using it will keep working.`,
      )
    ) {
      return;
    }
    try {
      await deleteAsset.mutateAsync(asset.assetId);
      toast.success('Removed from the library.');
    } catch (err) {
      // The most common cause is the asset still being used by a lesson, which
      // the backend refuses precisely so that lesson does not break.
      toast.error(err instanceof Error ? err.message : 'Could not remove it.');
    }
  };

  if (!courseId || !versionId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Open a course first to see its videos.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Course videos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload a full lecture once, then reuse it across as many lessons as
            you like — each lesson plays whatever start and end time you choose.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search videos"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-56 pl-8"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-msvideo"
            className="hidden"
            onChange={e => void handlePick(e.target.files?.[0])}
          />
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload video
          </Button>
        </div>
      </div>

      {isUploading && (
        <div className="mb-4 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === 'requesting' && 'Preparing upload…'}
              {phase === 'uploading' && `Uploading… ${progress}%`}
              {phase === 'finalizing' && 'Finishing up…'}
            </span>
            {phase === 'uploading' && (
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                <X className="mr-1 h-3 w-3" />
                Cancel
              </Button>
            )}
          </div>
          <Progress value={progress} className="mt-3" />
          <p className="mt-2 text-xs text-muted-foreground">
            Keep this page open until the bar completes. Processing afterwards
            continues on its own.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {processingCount > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          {processingCount} video{processingCount > 1 ? 's' : ''} still
          processing — this updates automatically.
        </p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-24">Length</TableHead>
              <TableHead className="w-36">Uploaded</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}

            {!isLoading && assets.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {search
                    ? `No videos match "${search}".`
                    : 'No videos yet. Upload a lecture to get started.'}
                </TableCell>
              </TableRow>
            )}

            {assets.map(asset => (
              <TableRow key={asset.assetId}>
                <TableCell>
                  {renamingId === asset.assetId ? (
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => void commitRename(asset)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void commitRename(asset);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="h-8 max-w-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startRename(asset)}
                      className="text-left font-medium hover:underline"
                      title="Click to rename"
                    >
                      {asset.title}
                    </button>
                  )}
                  {asset.status === 'FAILED' && asset.failureReason && (
                    <p className="mt-1 text-xs text-destructive">
                      {asset.failureReason}
                    </p>
                  )}
                </TableCell>

                <TableCell>
                  <StatusBadge status={asset.status} />
                </TableCell>

                <TableCell className="text-sm text-muted-foreground">
                  {formatDuration(asset.durationSeconds)}
                </TableCell>

                <TableCell className="text-sm text-muted-foreground">
                  {new Date(asset.createdAt).toLocaleDateString()}
                </TableCell>

                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!asset.playable}
                      onClick={() => setPreviewAsset(asset)}
                      title={
                        asset.playable ? 'Preview' : 'Available once processed'
                      }
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(asset)}
                      title="Remove from library"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={Boolean(previewAsset)}
        onOpenChange={open => !open && setPreviewAsset(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewAsset?.title}</DialogTitle>
          </DialogHeader>
          {previewAsset && (
            <HlsVideoPlayer
              assetId={previewAsset.assetId}
              className="aspect-video w-full"
              /**
               * Recording the duration here is what lets the item editor prefill
               * and validate segment timestamps without loading the video first.
               */
              onReady={seconds => {
                if (!previewAsset.durationSeconds && seconds > 0) {
                  updateAsset.mutate({
                    assetId: previewAsset.assetId,
                    durationSeconds: Math.round(seconds),
                  });
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: VideoAssetStatus }) {
  if (status === 'READY') {
    return (
      <Badge variant="outline" className="gap-1 text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </Badge>
    );
  }
  if (status === 'FAILED') {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />
      {status === 'UPLOADING' ? 'Uploading' : 'Processing'}
    </Badge>
  );
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
