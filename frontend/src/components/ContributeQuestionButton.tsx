import {useState} from 'react';
import {toast} from 'sonner';
import {Lightbulb, CheckCircle2, AlertCircle, Wand2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import StudentQuestionComposer from '@/components/StudentQuestionComposer';
import {useSubmitCrowdContribution} from '@/hooks/useCrowdContribution';
import type {StudentQuestionSubmissionPayload} from '@/types/student-question.types';
import type {
  CrowdContributionResult,
  CrowdSubmitResponse,
} from '@/types/crowd-contribution.types';

interface Feedback {
  result: CrowdContributionResult;
  message: string;
  suggestion?: string;
}

interface ContributeQuestionButtonProps {
  courseId: string;
  courseVersionId: string;
  segmentId: string;
  /** Button look — defaults to a small, non-distracting outline button. */
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
  label?: string;
  disabled?: boolean;
}

const TONE: Record<
  CrowdContributionResult,
  {wrap: string; Icon: typeof CheckCircle2}
> = {
  accept: {
    wrap: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    Icon: CheckCircle2,
  },
  needs_fix: {
    wrap: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    Icon: Wand2,
  },
  reject: {
    wrap: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    Icon: AlertCircle,
  },
  unavailable: {
    wrap: 'border-muted bg-muted/40 text-muted-foreground',
    Icon: AlertCircle,
  },
};

/**
 * Self-contained "Contribute a question" control: a small button that opens a
 * modal, runs the synchronous AI screening, and shows an encouraging result.
 * Drop it anywhere you have the segment context — it owns all of its own state
 * and talks only to the new /crowd-contributions API.
 */
export default function ContributeQuestionButton({
  courseId,
  courseVersionId,
  segmentId,
  variant = 'outline',
  size = 'sm',
  className,
  label = 'Contribute a question',
  disabled,
}: ContributeQuestionButtonProps) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const {submit, loading} = useSubmitCrowdContribution();

  const handleOpenChange = (next: boolean) => {
    if (loading) return; // don't close mid-check
    setOpen(next);
    if (!next) setFeedback(null);
  };

  const handleSubmit = async (payload: StudentQuestionSubmissionPayload) => {
    setFeedback(null);
    let res: CrowdSubmitResponse;
    try {
      res = await submit(courseId, courseVersionId, segmentId, payload);
    } catch (err: any) {
      toast.error(err?.message || 'Something went wrong — please try again.');
      setFeedback({
        result: 'unavailable',
        message: err?.message || 'Something went wrong — please try again.',
      });
      return;
    }

    if (res.result === 'accept') {
      toast.success(res.message || 'Your question passed our checks!');
      setOpen(false);
      setFeedback(null);
      return;
    }

    // needs_fix / reject / unavailable — keep the modal open so the student can
    // tweak their draft (the composer preserves it) and resubmit.
    setFeedback({
      result: res.result,
      message: res.message,
      suggestion: res.suggestion,
    });
    if (res.result === 'needs_fix') toast.message(res.message);
    else if (res.result === 'reject') toast.error(res.message);
    else toast.message(res.message);
  };

  const tone = feedback ? TONE[feedback.result] : null;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Lightbulb className="mr-1.5 h-4 w-4" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto"
          onInteractOutside={e => loading && e.preventDefault()}
          onEscapeKeyDown={e => loading && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Contribute a question</DialogTitle>
            <DialogDescription>
              Write a single-answer MCQ for this part of the lesson. We&apos;ll
              check it instantly before sending it to your teacher.
            </DialogDescription>
          </DialogHeader>

          {feedback && tone && (
            <div
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${tone.wrap}`}
            >
              <tone.Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p>{feedback.message}</p>
                {feedback.suggestion && (
                  <p className="text-xs opacity-90">
                    Suggested fix: {feedback.suggestion}
                  </p>
                )}
              </div>
            </div>
          )}

          {loading && (
            <p className="text-xs text-muted-foreground">
              Checking your question…
            </p>
          )}

          <StudentQuestionComposer
            isOpen={open}
            isSubmitting={loading}
            onCancel={() => handleOpenChange(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
