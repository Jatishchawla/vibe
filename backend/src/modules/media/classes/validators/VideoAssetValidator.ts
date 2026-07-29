import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {JSONSchema} from 'class-validator-jsonschema';
import {Type} from 'class-transformer';
import {VideoAssetStatus} from '../transformers/VideoAsset.js';

export class CreateVideoUploadUrlBody {
  @JSONSchema({
    title: 'Course ID',
    description: 'Course the uploaded video belongs to',
    type: 'string',
  })
  @IsNotEmpty()
  @IsMongoId()
  courseId: string;

  @JSONSchema({
    title: 'Course Version ID',
    description: 'Course version the uploaded video belongs to',
    type: 'string',
  })
  @IsNotEmpty()
  @IsMongoId()
  courseVersionId: string;

  @JSONSchema({
    title: 'File Name',
    description: 'Original filename, used to derive the stored extension',
    example: 'lecture-01.mp4',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  fileName: string;

  @JSONSchema({
    title: 'Content Type',
    description:
      'MIME type of the upload. Pinned into the signed URL — the PUT must send this exact Content-Type header.',
    example: 'video/mp4',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  contentType: string;

  @JSONSchema({
    title: 'Size in Bytes',
    description: 'Optional file size, validated against the configured maximum',
    example: 524288000,
    type: 'number',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes?: number;
}

export class VideoAssetIdParams {
  @JSONSchema({
    title: 'Video Asset ID',
    type: 'string',
  })
  @IsNotEmpty()
  @IsMongoId()
  assetId: string;
}

export class ListVideoAssetsQuery {
  @IsNotEmpty()
  @IsMongoId()
  courseId: string;

  @IsNotEmpty()
  @IsMongoId()
  courseVersionId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CreateVideoUploadUrlResponse {
  @JSONSchema({type: 'string'})
  assetId: string;

  @JSONSchema({
    description: 'Signed URL to PUT the file to. Never proxied through ViBe.',
    type: 'string',
  })
  uploadUrl: string;

  @JSONSchema({type: 'string'})
  uploadObjectKey: string;

  @JSONSchema({
    description: 'When the upload URL stops working',
    type: 'string',
  })
  expiresAt: Date;

  @JSONSchema({
    description: 'Content-Type header the PUT must send, byte for byte',
    type: 'string',
  })
  requiredContentType: string;
}

export class VideoAssetResponse {
  @JSONSchema({type: 'string'})
  assetId: string;

  @JSONSchema({type: 'string'})
  status: VideoAssetStatus;

  @JSONSchema({type: 'string'})
  originalFileName: string;

  @JSONSchema({
    description: 'True when a playback grant can be issued',
    type: 'boolean',
  })
  playable: boolean;

  @JSONSchema({type: 'number'})
  sizeBytes?: number;

  @JSONSchema({type: 'number'})
  durationSeconds?: number;

  @JSONSchema({type: 'string'})
  failureReason?: string;

  @JSONSchema({type: 'string'})
  createdAt: Date;
}

export class VideoAssetListResponse {
  items: VideoAssetResponse[];
}

export class VideoPlaybackGrantResponse {
  @JSONSchema({
    description: 'HLS master playlist URL for the player to load',
    type: 'string',
  })
  url: string;

  @JSONSchema({
    description:
      'When the grant expires. Clients should re-request before this to avoid a mid-lesson stall.',
    type: 'string',
  })
  expiresAt: Date;
}
