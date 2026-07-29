import {inject, injectable} from 'inversify';
import {
  Authorized,
  Body,
  CurrentUser,
  Get,
  HttpCode,
  JsonController,
  Params,
  Post,
  QueryParams,
} from 'routing-controllers';
import {OpenAPI, ResponseSchema} from 'routing-controllers-openapi';
import {IUser} from '#root/shared/interfaces/models.js';
import {MEDIA_TYPES} from '../types.js';
import {VideoAssetService} from '../services/VideoAssetService.js';
import {IVideoAsset} from '../classes/transformers/VideoAsset.js';
import {
  CreateVideoUploadUrlBody,
  CreateVideoUploadUrlResponse,
  ListVideoAssetsQuery,
  VideoAssetIdParams,
  VideoAssetListResponse,
  VideoAssetResponse,
  VideoPlaybackGrantResponse,
} from '../classes/validators/VideoAssetValidator.js';

@OpenAPI({
  tags: ['Video Assets'],
})
@JsonController('/media/video-assets', {transformResponse: true})
@injectable()
export class VideoAssetController {
  constructor(
    @inject(MEDIA_TYPES.VideoAssetService)
    private readonly service: VideoAssetService,
  ) {}

  @OpenAPI({
    summary: 'Request a signed URL to upload a course video',
    description:
      'Reserves a video asset and returns a signed PUT URL. The browser uploads ' +
      'directly to cloud storage — the bytes never pass through ViBe.',
  })
  @Authorized()
  @Post('/upload-url')
  @HttpCode(201)
  @ResponseSchema(CreateVideoUploadUrlResponse)
  async createUploadUrl(
    @Body() body: CreateVideoUploadUrlBody,
    @CurrentUser() user: IUser,
  ): Promise<CreateVideoUploadUrlResponse> {
    return this.service.createUploadUrl({
      user,
      courseId: body.courseId,
      courseVersionId: body.courseVersionId,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
  }

  @OpenAPI({
    summary: 'Report that an upload finished',
    description:
      'Treated as a hint: the asset only advances if the object is actually ' +
      'present in the bucket.',
  })
  @Authorized()
  @Post('/:assetId/uploaded')
  @HttpCode(200)
  @ResponseSchema(VideoAssetResponse)
  async markUploaded(
    @Params() params: VideoAssetIdParams,
    @CurrentUser() user: IUser,
  ): Promise<VideoAssetResponse> {
    const asset = await this.service.markUploaded(params.assetId, user);
    return toAssetResponse(asset);
  }

  @OpenAPI({
    summary: 'Get processing status for a video asset',
    description:
      'Refreshes readiness from the stream bucket while the asset is still in ' +
      'flight, so status is correct with or without a pipeline webhook.',
  })
  @Authorized()
  @Get('/:assetId')
  @HttpCode(200)
  @ResponseSchema(VideoAssetResponse)
  async getStatus(
    @Params() params: VideoAssetIdParams,
    @CurrentUser() user: IUser,
  ): Promise<VideoAssetResponse> {
    const asset = await this.service.getStatus(params.assetId, user);
    return toAssetResponse(asset);
  }

  @OpenAPI({
    summary: 'Get a time-boxed playback URL for a ready video',
    description:
      'Returns the HLS master playlist URL. Authorization is resolved against ' +
      "the asset's course scope, so only the uploader, course staff, admins and " +
      'enrolled learners can obtain a grant.',
  })
  @Authorized()
  @Get('/:assetId/playback-url')
  @HttpCode(200)
  @ResponseSchema(VideoPlaybackGrantResponse)
  async getPlaybackUrl(
    @Params() params: VideoAssetIdParams,
    @CurrentUser() user: IUser,
  ): Promise<VideoPlaybackGrantResponse> {
    const grant = await this.service.createPlaybackGrant(params.assetId, user);
    return {url: grant.url, expiresAt: grant.expiresAt};
  }

  @OpenAPI({
    summary: 'List video assets for a course version',
  })
  @Authorized()
  @Get('/')
  @HttpCode(200)
  @ResponseSchema(VideoAssetListResponse)
  async list(
    @QueryParams() query: ListVideoAssetsQuery,
    @CurrentUser() user: IUser,
  ): Promise<VideoAssetListResponse> {
    const assets = await this.service.listByCourseVersion({
      user,
      courseId: query.courseId,
      courseVersionId: query.courseVersionId,
      limit: query.limit,
    });
    return {items: assets.map(toAssetResponse)};
  }
}

function toAssetResponse(asset: IVideoAsset): VideoAssetResponse {
  return {
    assetId: asset._id?.toString() ?? '',
    status: asset.status,
    originalFileName: asset.originalFileName,
    playable: asset.status === 'READY' && Boolean(asset.playlistObjectKey),
    sizeBytes: asset.sizeBytes,
    durationSeconds: asset.durationSeconds,
    failureReason: asset.failureReason,
    createdAt: asset.createdAt,
  };
}
