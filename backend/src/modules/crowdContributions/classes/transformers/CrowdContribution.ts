import {ObjectId} from 'mongodb';

export type CrowdContributionStatus =
  | 'SCREENING' // transient: being validated during submit (rarely persisted)
  | 'HELD' // failed AI / needs_fix (never enters the review queue)
  | 'PENDING_REVIEW' // passed AI + dedup; awaiting teacher review
  | 'APPROVED'
  | 'REJECTED';

export type CrowdQuestionType = 'SELECT_ONE_IN_LOT';

export type CrowdContributionSource = 'STUDENT_GENERATED';

export type CrowdVerdict = 'accept' | 'reject' | 'needs_fix';

export type CrowdCategory =
  | 'spam'
  | 'gibberish'
  | 'off_topic'
  | 'wrong_answer'
  | 'too_easy_or_hard'
  | 'duplicate'
  | 'ok';

export interface ICrowdContributionOption {
  text: string;
}

/** Snapshot of the AI judge's verdict, persisted on the contribution. */
export interface IScreeningVerdict {
  verdict: CrowdVerdict;
  category: CrowdCategory;
  checks: {
    wellFormed: boolean;
    onTopic: boolean;
    answerDefensible: boolean;
    notSpam: boolean;
  };
  studentMessage: string;
  suggestedFix?: string;
  model: string;
  latencyMs?: number;
  at: Date;
}

export interface ICrowdContribution {
  _id?: ObjectId;
  courseId: ObjectId;
  courseVersionId: ObjectId;
  segmentId: ObjectId;
  questionType: CrowdQuestionType;
  questionText: string;
  options: ICrowdContributionOption[];
  correctOptionIndex: number;
  normalizedSignature: string;
  embedding?: number[];
  embeddingModel?: string;
  screeningVerdict?: IScreeningVerdict;
  status: CrowdContributionStatus;
  source: CrowdContributionSource;
  /** set when this contribution is a hard-duplicate of an existing one. */
  dedupOf?: ObjectId | null;
  /** set when a near-duplicate exists; flagged for the teacher to resolve. */
  possibleDuplicateOf?: ObjectId | null;
  createdBy: ObjectId;
  reviewedBy?: ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
  isDeleted?: boolean;
  deletedAt?: Date;
}

/**
 * Domain object for a contribution that has PASSED screening + dedup and is
 * ready to persist as PENDING_REVIEW. (Rejected / needs_fix submissions are
 * never stored as full contributions — only as lightweight attempt stubs.)
 */
export class CrowdContribution implements ICrowdContribution {
  _id?: ObjectId;
  courseId: ObjectId;
  courseVersionId: ObjectId;
  segmentId: ObjectId;
  questionType: CrowdQuestionType;
  questionText: string;
  options: ICrowdContributionOption[];
  correctOptionIndex: number;
  normalizedSignature: string;
  embedding?: number[];
  embeddingModel?: string;
  screeningVerdict?: IScreeningVerdict;
  status: CrowdContributionStatus;
  source: CrowdContributionSource;
  dedupOf?: ObjectId | null;
  possibleDuplicateOf?: ObjectId | null;
  createdBy: ObjectId;
  reviewedBy?: ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
  isDeleted?: boolean;
  deletedAt?: Date;

  constructor(input: {
    courseId: string;
    courseVersionId: string;
    segmentId: string;
    questionType: CrowdQuestionType;
    questionText: string;
    options: ICrowdContributionOption[];
    correctOptionIndex: number;
    normalizedSignature: string;
    createdBy: string;
    screeningVerdict: IScreeningVerdict;
    embedding?: number[];
    embeddingModel?: string;
    possibleDuplicateOf?: ObjectId | null;
  }) {
    this.courseId = new ObjectId(input.courseId);
    this.courseVersionId = new ObjectId(input.courseVersionId);
    this.segmentId = new ObjectId(input.segmentId);
    this.questionType = input.questionType;
    this.questionText = input.questionText;
    this.options = input.options;
    this.correctOptionIndex = input.correctOptionIndex;
    this.normalizedSignature = input.normalizedSignature;
    this.screeningVerdict = input.screeningVerdict;
    this.embedding = input.embedding;
    this.embeddingModel = input.embeddingModel;
    this.possibleDuplicateOf = input.possibleDuplicateOf ?? null;
    this.dedupOf = null;
    this.status = 'PENDING_REVIEW';
    this.source = 'STUDENT_GENERATED';
    this.createdBy = new ObjectId(input.createdBy);
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.isDeleted = false;
  }
}
