import {ObjectId} from 'mongodb';

/**
 * Lifecycle of an uploaded video, from the browser's PUT to a playable HLS
 * ladder.
 *
 * UPLOADING  = an upload URL was issued; bytes may or may not have landed yet.
 * PROCESSING = the raw object exists; the cloud transcoder is producing variants.
 * READY      = a master playlist is present in the stream bucket and playable.
 * FAILED     = no playlist was produced (see `failureReason`).
 *
 * ViBe never transcodes — it only observes. READY is therefore always derived
 * from the stream bucket, never asserted by a client, so a malicious or buggy
 * caller cannot mark an asset playable.
 */
export type VideoAssetStatus =
  | 'UPLOADING'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED';

export interface IVideoAsset {
  _id?: ObjectId;
  /**
   * Course scope the upload was made under. Playback authorization is resolved
   * against this pair, so it is required at creation rather than backfilled
   * when an item eventually references the asset.
   */
  courseId: ObjectId;
  courseVersionId: ObjectId;
  /** Teacher who requested the upload URL. */
  createdBy: ObjectId;
  /** Original filename, kept only for display in the teacher UI. */
  originalFileName: string;
  /** MIME type pinned into the signed upload URL; the PUT must match it. */
  contentType: string;
  /** Object path inside the upload bucket (the transcoder's input). */
  uploadObjectKey: string;
  /**
   * Object path of the master playlist inside the stream bucket, once observed.
   * Absent until status is READY.
   */
  playlistObjectKey?: string;
  status: VideoAssetStatus;
  /** Set when status is FAILED, surfaced to the teacher. */
  failureReason?: string;
  /** Byte size as reported by the bucket after the upload landed. */
  sizeBytes?: number;
  /** Playback duration in seconds, once known from the transcoder output. */
  durationSeconds?: number;
  uploadedAt?: Date;
  readyAt?: Date;
  /** Last time readiness was checked against the stream bucket. */
  lastPolledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  isDeleted?: boolean;
  deletedAt?: Date;
}

export class VideoAsset implements IVideoAsset {
  courseId: ObjectId;
  courseVersionId: ObjectId;
  createdBy: ObjectId;
  originalFileName: string;
  contentType: string;
  uploadObjectKey: string;
  playlistObjectKey?: string;
  status: VideoAssetStatus;
  failureReason?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  uploadedAt?: Date;
  readyAt?: Date;
  lastPolledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  isDeleted?: boolean;
  deletedAt?: Date;

  constructor(input: {
    courseId: string;
    courseVersionId: string;
    createdBy: string;
    originalFileName: string;
    contentType: string;
    uploadObjectKey: string;
  }) {
    this.courseId = new ObjectId(input.courseId);
    this.courseVersionId = new ObjectId(input.courseVersionId);
    this.createdBy = new ObjectId(input.createdBy);
    this.originalFileName = input.originalFileName;
    this.contentType = input.contentType;
    this.uploadObjectKey = input.uploadObjectKey;
    this.status = 'UPLOADING';
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.isDeleted = false;
  }
}
