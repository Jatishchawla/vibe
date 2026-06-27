import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Loader2, RefreshCw, Check, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useCourseStore} from '@/store/course-store';
import {useCrowdReviewQueue} from '@/hooks/useCrowdContribution';
import type {CrowdContributionListItem} from '@/types/crowd-contribution.types';

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Standalone teacher surface for the AI-validated contribution queue.
 * Lists PENDING_REVIEW crowd contributions and lets a reviewer approve/reject.
 * Self-contained — wire it into a teacher route when ready.
 */
export default function CrowdReviewQueue() {
  const {currentCourse} = useCourseStore();
  const courseId = currentCourse?.courseId;
  const courseVersionId = currentCourse?.versionId;

  const [items, setItems] = useState<CrowdContributionListItem[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const {listReviewQueue, approve, reject, loading} = useCrowdReviewQueue();

  const fetchQueue = useCallback(async () => {
    if (!courseId || !courseVersionId) return;
    try {
      const res = await listReviewQueue(courseId, courseVersionId, 100);
      setItems(res?.items ?? []);
      setHasFetched(true);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load the review queue');
    }
  }, [courseId, courseVersionId, listReviewQueue]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  const handleApprove = async (item: CrowdContributionListItem) => {
    try {
      await approve(item._id);
      toast.success('Question approved');
      await fetchQueue();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to approve');
    }
  };

  const handleReject = async (item: CrowdContributionListItem) => {
    const reason = window.prompt('Reason for rejecting (shown to the student):');
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Please provide a short reason (at least 3 characters).');
      return;
    }
    try {
      await reject(item._id, reason.trim());
      toast.success('Question rejected');
      await fetchQueue();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reject');
    }
  };

  if (!courseId || !courseVersionId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Select a course version first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Contributed Questions — Review</h1>
          <p className="text-xs text-muted-foreground">
            AI-screened student questions awaiting your approval.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void fetchQueue()}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && !hasFetched ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          Nothing waiting for review right now.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map(item => (
            <div
              key={item._id}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <p className="font-medium">{item.questionText}</p>
              <ul className="mt-3 space-y-1.5">
                {item.options.map((opt, i) => (
                  <li
                    key={i}
                    className={`flex items-center gap-2 text-sm ${
                      i === item.correctOptionIndex
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {OPTION_LABELS[i]}
                    </span>
                    {opt.text}
                    {i === item.correctOptionIndex && (
                      <span className="text-xs">(correct)</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleReject(item)}
                  disabled={loading}
                >
                  <X className="mr-1 h-4 w-4" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleApprove(item)}
                  disabled={loading}
                >
                  <Check className="mr-1 h-4 w-4" />
                  Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
