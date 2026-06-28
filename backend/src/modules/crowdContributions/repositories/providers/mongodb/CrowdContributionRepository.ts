import 'reflect-metadata';
import {Collection, ObjectId} from 'mongodb';
import {injectable, inject} from 'inversify';
import {MongoDatabase} from '#shared/database/providers/mongo/MongoDatabase.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {
  CrowdContribution,
  CrowdContributionStatus,
  ICrowdContribution,
} from '../../../classes/transformers/CrowdContribution.js';

/** A lightweight, append-only record of every submit attempt (incl. rejected),
 * used for DB-backed rate limiting and later filter tuning. */
interface ICrowdAttempt {
  _id?: ObjectId;
  createdBy: ObjectId;
  segmentId: ObjectId;
  verdict?: string;
  category?: string;
  normalizedSignature: string;
  createdAt: Date;
}

export interface ISegmentEmbedding {
  _id: ObjectId;
  embedding: number[];
}

@injectable()
export class CrowdContributionRepository {
  private collection!: Collection<ICrowdContribution>;
  private attempts!: Collection<ICrowdAttempt>;
  private initialized = false;

  constructor(@inject(GLOBAL_TYPES.Database) private db: MongoDatabase) {}

  private async init() {
    if (this.initialized) return;
    this.collection =
      await this.db.getCollection<ICrowdContribution>('crowdContributions');
    this.attempts =
      await this.db.getCollection<ICrowdAttempt>('crowdContributionAttempts');
    this.initialized = true;

    try {
      await this.collection.createIndex(
        {courseVersionId: 1, segmentId: 1, isDeleted: 1},
        {background: true},
      );
      await this.collection.createIndex(
        {createdBy: 1, isDeleted: 1},
        {background: true},
      );
      await this.collection.createIndex(
        {courseId: 1, courseVersionId: 1, status: 1, isDeleted: 1},
        {background: true},
      );
      await this.collection.createIndex(
        {courseVersionId: 1, segmentId: 1, normalizedSignature: 1, isDeleted: 1},
        {background: true},
      );
      await this.attempts.createIndex(
        {createdBy: 1, segmentId: 1, createdAt: -1},
        {background: true},
      );
    } catch {
      // indexes already exist
    }
  }

  async create(contribution: CrowdContribution): Promise<string> {
    await this.init();
    const result = await this.collection.insertOne(contribution);
    return result.insertedId.toString();
  }

  async logAttempt(input: {
    createdBy: string;
    segmentId: string;
    verdict?: string;
    category?: string;
    normalizedSignature: string;
  }): Promise<void> {
    await this.init();
    await this.attempts
      .insertOne({
        createdBy: new ObjectId(input.createdBy),
        segmentId: new ObjectId(input.segmentId),
        verdict: input.verdict,
        category: input.category,
        normalizedSignature: input.normalizedSignature,
        createdAt: new Date(),
      })
      .catch(() => {});
  }

  async countAttemptsSince(input: {
    createdBy: string;
    segmentId: string;
    since: Date;
  }): Promise<number> {
    await this.init();
    return this.attempts.countDocuments({
      createdBy: new ObjectId(input.createdBy),
      segmentId: new ObjectId(input.segmentId),
      createdAt: {$gte: input.since},
    });
  }

  async findExactDuplicate(input: {
    courseVersionId: string;
    segmentId: string;
    normalizedSignature: string;
  }): Promise<ICrowdContribution | null> {
    await this.init();
    return this.collection.findOne({
      courseVersionId: new ObjectId(input.courseVersionId),
      segmentId: new ObjectId(input.segmentId),
      normalizedSignature: input.normalizedSignature,
      status: {$in: ['PENDING_REVIEW', 'APPROVED']},
      isDeleted: {$ne: true},
    });
  }

  /** Existing vectors for a segment (for in-app cosine near-dup detection).
   * Works on any MongoDB — no Atlas Vector Search required. */
  async listSegmentEmbeddings(input: {
    courseVersionId: string;
    segmentId: string;
    limit?: number;
  }): Promise<ISegmentEmbedding[]> {
    await this.init();
    const docs = await this.collection
      .find(
        {
          courseVersionId: new ObjectId(input.courseVersionId),
          segmentId: new ObjectId(input.segmentId),
          status: {$in: ['PENDING_REVIEW', 'APPROVED']},
          isDeleted: {$ne: true},
          embedding: {$type: 'array'},
        },
        {projection: {embedding: 1}},
      )
      .limit(input.limit ?? 500)
      .toArray();
    return docs
      .filter(d => Array.isArray((d as any).embedding))
      .map(d => ({_id: d._id as ObjectId, embedding: (d as any).embedding}));
  }

  async findById(id: string): Promise<ICrowdContribution | null> {
    await this.init();
    return this.collection.findOne({
      _id: new ObjectId(id),
      isDeleted: {$ne: true},
    });
  }

  async listByUser(input: {
    userId: string;
    status?: CrowdContributionStatus;
    limit: number;
  }): Promise<ICrowdContribution[]> {
    await this.init();
    const filter: Record<string, unknown> = {
      createdBy: new ObjectId(input.userId),
      isDeleted: {$ne: true},
    };
    if (input.status) filter.status = input.status;
    return this.collection
      .find(filter)
      .sort({createdAt: -1})
      .limit(input.limit)
      .toArray();
  }

  async listReviewQueue(input: {
    courseId: string;
    courseVersionId: string;
    limit: number;
  }): Promise<ICrowdContribution[]> {
    await this.init();
    return this.collection
      .find({
        courseId: new ObjectId(input.courseId),
        courseVersionId: new ObjectId(input.courseVersionId),
        status: 'PENDING_REVIEW',
        isDeleted: {$ne: true},
      })
      .sort({createdAt: -1})
      .limit(input.limit)
      .toArray();
  }

  async updateStatus(input: {
    id: string;
    status: CrowdContributionStatus;
    reviewedBy: string;
    rejectionReason?: string;
  }): Promise<boolean> {
    await this.init();
    const result = await this.collection.updateOne(
      {_id: new ObjectId(input.id), isDeleted: {$ne: true}},
      {
        $set: {
          status: input.status,
          reviewedBy: new ObjectId(input.reviewedBy),
          reviewedAt: new Date(),
          rejectionReason:
            input.status === 'REJECTED' ? input.rejectionReason : undefined,
          updatedAt: new Date(),
        },
      },
    );
    return result.matchedCount > 0;
  }
}
