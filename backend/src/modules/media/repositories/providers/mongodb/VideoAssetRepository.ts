import 'reflect-metadata';
import {Collection, ObjectId} from 'mongodb';
import {inject, injectable} from 'inversify';
import {MongoDatabase} from '#shared/database/providers/mongo/MongoDatabase.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {
  IVideoAsset,
  VideoAssetStatus,
} from '../../../classes/transformers/VideoAsset.js';

@injectable()
export class VideoAssetRepository {
  private collection!: Collection<IVideoAsset>;
  private initialized = false;

  constructor(@inject(GLOBAL_TYPES.Database) private db: MongoDatabase) {}

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.collection = await this.db.getCollection<IVideoAsset>('videoAssets');
    this.initialized = true;

    try {
      // Teacher-facing listing: assets of one course version, newest first.
      await this.collection.createIndex({
        courseVersionId: 1,
        isDeleted: 1,
        createdAt: -1,
      });
      // The readiness poller scans only assets still in flight.
      await this.collection.createIndex({status: 1, lastPolledAt: 1});
    } catch (error) {
      // Index creation is best-effort: a replica lacking permission must not
      // stop the module from serving reads and writes.
      console.warn('[VideoAssetRepository] index creation skipped:', error);
    }
  }

  async create(asset: IVideoAsset): Promise<IVideoAsset> {
    await this.init();
    const result = await this.collection.insertOne(asset);
    return {...asset, _id: result.insertedId};
  }

  async findById(assetId: string): Promise<IVideoAsset | null> {
    await this.init();
    if (!ObjectId.isValid(assetId)) return null;
    return this.collection.findOne({
      _id: new ObjectId(assetId),
      isDeleted: {$ne: true},
    });
  }

  async listByCourseVersion(
    courseVersionId: string,
    limit = 100,
  ): Promise<IVideoAsset[]> {
    await this.init();
    if (!ObjectId.isValid(courseVersionId)) return [];
    return this.collection
      .find({
        courseVersionId: new ObjectId(courseVersionId),
        isDeleted: {$ne: true},
      })
      .sort({createdAt: -1})
      .limit(limit)
      .toArray();
  }

  /**
   * Assets that may still change state, oldest-polled first. Drives the
   * readiness sweep; a webhook from the pipeline can short-circuit it later
   * without changing this method.
   */
  async listInFlight(limit = 25): Promise<IVideoAsset[]> {
    await this.init();
    return this.collection
      .find({
        status: {$in: ['UPLOADING', 'PROCESSING'] as VideoAssetStatus[]},
        isDeleted: {$ne: true},
      })
      .sort({lastPolledAt: 1})
      .limit(limit)
      .toArray();
  }

  async update(
    assetId: string,
    changes: Partial<IVideoAsset>,
  ): Promise<IVideoAsset | null> {
    await this.init();
    if (!ObjectId.isValid(assetId)) return null;
    const result = await this.collection.findOneAndUpdate(
      {_id: new ObjectId(assetId), isDeleted: {$ne: true}},
      {$set: {...changes, updatedAt: new Date()}},
      {returnDocument: 'after'},
    );
    return result ?? null;
  }

  async softDelete(assetId: string): Promise<boolean> {
    await this.init();
    if (!ObjectId.isValid(assetId)) return false;
    const result = await this.collection.updateOne(
      {_id: new ObjectId(assetId), isDeleted: {$ne: true}},
      {$set: {isDeleted: true, deletedAt: new Date(), updatedAt: new Date()}},
    );
    return result.modifiedCount === 1;
  }
}
