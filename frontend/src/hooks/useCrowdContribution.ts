import {useState} from 'react';
import type {StudentQuestionSubmissionPayload} from '@/types/student-question.types';
import type {
  CrowdContributionListResponse,
  CrowdStatusFilter,
  CrowdSubmitResponse,
} from '@/types/crowd-contribution.types';

const BASE = import.meta.env.VITE_BASE_URL;

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    authorization: `Bearer ${localStorage.getItem('firebase-auth-token')}`,
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.message || body?.error || `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

/** Synchronous submit → on-spot AI verdict (accept / reject / needs_fix / unavailable). */
export function useSubmitCrowdContribution(): {
  submit: (
    courseId: string,
    courseVersionId: string,
    segmentId: string,
    payload: StudentQuestionSubmissionPayload,
  ) => Promise<CrowdSubmitResponse>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (
    courseId: string,
    courseVersionId: string,
    segmentId: string,
    payload: StudentQuestionSubmissionPayload,
  ): Promise<CrowdSubmitResponse> => {
    setLoading(true);
    setError(null);
    try {
      const url = `${BASE}/crowd-contributions/courses/${courseId}/versions/${courseVersionId}/segments/${segmentId}/submit`;
      const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readError(response));
      return (await response.json()) as CrowdSubmitResponse;
    } catch (err: any) {
      setError(err?.message || 'Failed to submit contribution');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {submit, loading, error};
}

/** Teacher review queue: list PENDING_REVIEW + approve / reject. */
export function useCrowdReviewQueue(): {
  listReviewQueue: (
    courseId: string,
    courseVersionId: string,
    limit?: number,
  ) => Promise<CrowdContributionListResponse>;
  approve: (contributionId: string) => Promise<void>;
  reject: (contributionId: string, reason: string) => Promise<void>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listReviewQueue = async (
    courseId: string,
    courseVersionId: string,
    limit = 100,
  ): Promise<CrowdContributionListResponse> => {
    setLoading(true);
    setError(null);
    try {
      const url = `${BASE}/crowd-contributions/courses/${courseId}/versions/${courseVersionId}/review-queue?limit=${limit}`;
      const response = await fetch(url, {headers: authHeaders()});
      if (!response.ok) throw new Error(await readError(response));
      return (await response.json()) as CrowdContributionListResponse;
    } catch (err: any) {
      setError(err?.message || 'Failed to load review queue');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const patch = async (contributionId: string, action: 'approve' | 'reject', reason?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${BASE}/crowd-contributions/${contributionId}/${action}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: authHeaders(),
        body: reason ? JSON.stringify({reason}) : undefined,
      });
      if (!response.ok) throw new Error(await readError(response));
    } catch (err: any) {
      setError(err?.message || `Failed to ${action}`);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    listReviewQueue,
    approve: (id: string) => patch(id, 'approve'),
    reject: (id: string, reason: string) => patch(id, 'reject', reason),
    loading,
    error,
  };
}

/** The current student's own contributions + statuses. */
export function useMyCrowdContributions(): {
  listMine: (
    status?: CrowdStatusFilter,
    limit?: number,
  ) => Promise<CrowdContributionListResponse>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listMine = async (
    status?: CrowdStatusFilter,
    limit = 100,
  ): Promise<CrowdContributionListResponse> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', String(limit));
      const url = `${BASE}/crowd-contributions/me?${params.toString()}`;
      const response = await fetch(url, {headers: authHeaders()});
      if (!response.ok) throw new Error(await readError(response));
      return (await response.json()) as CrowdContributionListResponse;
    } catch (err: any) {
      setError(err?.message || 'Failed to load your contributions');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {listMine, loading, error};
}
