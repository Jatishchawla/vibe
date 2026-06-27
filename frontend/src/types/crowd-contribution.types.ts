// Types for the AI-validated student question contribution feature (Phase 1).
// Mirrors the backend `crowdContributions` module's REST contract.

export type CrowdContributionResult =
  | 'accept'
  | 'reject'
  | 'needs_fix'
  | 'unavailable';

/** Response from POST /crowd-contributions/.../submit (synchronous AI screen). */
export interface CrowdSubmitResponse {
  result: CrowdContributionResult;
  message: string;
  suggestion?: string;
  contributionId?: string;
}

export interface CrowdContributionListItem {
  _id: string;
  segmentId: string;
  questionText: string;
  options: {text: string}[];
  correctOptionIndex: number;
  status: string;
  createdBy: string;
  createdAt: string;
  rejectionReason?: string;
}

export interface CrowdContributionListResponse {
  items: CrowdContributionListItem[];
}

export type CrowdStatusFilter =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ALL';
