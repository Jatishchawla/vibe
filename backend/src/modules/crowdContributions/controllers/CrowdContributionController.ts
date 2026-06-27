import {inject, injectable} from 'inversify';
import {
  Authorized,
  Body,
  CurrentUser,
  ForbiddenError,
  Get,
  HttpCode,
  JsonController,
  Params,
  Patch,
  Post,
  QueryParams,
} from 'routing-controllers';
import {OpenAPI, ResponseSchema} from 'routing-controllers-openapi';
import {IUser} from '#root/shared/interfaces/models.js';
import {CROWD_CONTRIBUTION_TYPES} from '../types.js';
import {CrowdContributionService} from '../services/CrowdContributionService.js';
import {ICrowdContribution} from '../classes/transformers/CrowdContribution.js';
import {
  ContributionIdPathParams,
  ContributionListResponse,
  ContributionPathParams,
  CourseVersionPathParams,
  MyContributionsQuery,
  RejectContributionBody,
  ReviewQueueQuery,
  SubmitContributionBody,
  SubmitContributionResponse,
} from '../classes/validators/CrowdContributionValidator.js';

function toListItem(c: ICrowdContribution) {
  return {
    _id: c._id?.toString() || '',
    segmentId: c.segmentId.toString(),
    questionText: c.questionText,
    options: c.options.map(o => ({text: o.text})),
    correctOptionIndex: c.correctOptionIndex,
    status: c.status,
    createdBy: c.createdBy.toString(),
    createdAt: c.createdAt.toISOString(),
    rejectionReason: c.rejectionReason,
  };
}

@OpenAPI({tags: ['Crowd Contributions']})
@JsonController('/crowd-contributions')
@injectable()
export class CrowdContributionController {
  constructor(
    @inject(CROWD_CONTRIBUTION_TYPES.CrowdContributionService)
    private readonly service: CrowdContributionService,
  ) {}

  @Authorized()
  @Post('/courses/:courseId/versions/:courseVersionId/segments/:segmentId/submit')
  @HttpCode(200)
  @ResponseSchema(SubmitContributionResponse)
  async submit(
    @Params() params: ContributionPathParams,
    @Body() body: SubmitContributionBody,
    @CurrentUser() user: IUser,
  ): Promise<SubmitContributionResponse> {
    const createdBy = user._id?.toString();
    if (!createdBy) {
      throw new ForbiddenError('Unable to resolve authenticated user.');
    }
    return this.service.submit({
      courseId: params.courseId,
      courseVersionId: params.courseVersionId,
      segmentId: params.segmentId,
      questionType: body.questionType,
      questionText: body.questionText,
      options: body.options,
      correctOptionIndex: body.correctOptionIndex,
      createdBy,
    });
  }

  @Authorized()
  @Get('/me')
  @HttpCode(200)
  @ResponseSchema(ContributionListResponse)
  async listMine(
    @QueryParams() query: MyContributionsQuery,
    @CurrentUser() user: IUser,
  ): Promise<ContributionListResponse> {
    const userId = user._id?.toString();
    if (!userId) {
      throw new ForbiddenError('Unable to resolve authenticated user.');
    }
    const items = await this.service.listMyContributions({
      userId,
      status: query.status,
      limit: query.limit ?? 100,
    });
    return {items: items.map(toListItem)};
  }

  @Authorized()
  @Get('/courses/:courseId/versions/:courseVersionId/review-queue')
  @HttpCode(200)
  @ResponseSchema(ContributionListResponse)
  async reviewQueue(
    @Params() params: CourseVersionPathParams,
    @QueryParams() query: ReviewQueueQuery,
    @CurrentUser() user: IUser,
  ): Promise<ContributionListResponse> {
    const items = await this.service.listReviewQueue({
      reviewerRole: user.roles,
      courseId: params.courseId,
      courseVersionId: params.courseVersionId,
      limit: query.limit ?? 100,
    });
    return {items: items.map(toListItem)};
  }

  @Authorized()
  @Patch('/:contributionId/approve')
  @HttpCode(200)
  async approve(
    @Params() params: ContributionIdPathParams,
    @CurrentUser() user: IUser,
  ): Promise<{success: true}> {
    const reviewerId = user._id?.toString();
    if (!reviewerId) {
      throw new ForbiddenError('Unable to resolve authenticated user.');
    }
    await this.service.approve({
      contributionId: params.contributionId,
      reviewerId,
      reviewerRole: user.roles,
    });
    return {success: true};
  }

  @Authorized()
  @Patch('/:contributionId/reject')
  @HttpCode(200)
  async reject(
    @Params() params: ContributionIdPathParams,
    @Body() body: RejectContributionBody,
    @CurrentUser() user: IUser,
  ): Promise<{success: true}> {
    const reviewerId = user._id?.toString();
    if (!reviewerId) {
      throw new ForbiddenError('Unable to resolve authenticated user.');
    }
    await this.service.reject({
      contributionId: params.contributionId,
      reviewerId,
      reviewerRole: user.roles,
      reason: body.reason,
    });
    return {success: true};
  }
}
