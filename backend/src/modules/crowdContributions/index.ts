import {Container, ContainerModule} from 'inversify';
import {RoutingControllersOptions, useContainer} from 'routing-controllers';
import {sharedContainerModule} from '#root/container.js';
import {InversifyAdapter} from '#root/inversify-adapter.js';
import {crowdContributionsContainerModule} from './container.js';
import {CrowdContributionController} from './controllers/CrowdContributionController.js';
import {
  ContributionIdPathParams,
  ContributionListItemResponse,
  ContributionListResponse,
  ContributionPathParams,
  CourseVersionPathParams,
  CrowdContributionOptionDto,
  MyContributionsQuery,
  RejectContributionBody,
  ReviewQueueQuery,
  SubmitContributionBody,
  SubmitContributionResponse,
} from './classes/validators/CrowdContributionValidator.js';

export const crowdContributionsContainerModules: ContainerModule[] = [
  crowdContributionsContainerModule,
  sharedContainerModule,
];

export const crowdContributionsModuleControllers: Function[] = [
  CrowdContributionController,
];

export async function setupCrowdContributionsContainer(): Promise<void> {
  const container = new Container();
  await container.load(...crowdContributionsContainerModules);
  const inversifyAdapter = new InversifyAdapter(container);
  useContainer(inversifyAdapter);
}

export const crowdContributionsModuleOptions: RoutingControllersOptions = {
  controllers: crowdContributionsModuleControllers,
  middlewares: [],
  defaultErrorHandler: true,
  authorizationChecker: async function () {
    return true;
  },
  validation: true,
};

export const crowdContributionsModuleValidators: Function[] = [
  CrowdContributionOptionDto,
  SubmitContributionBody,
  ContributionPathParams,
  CourseVersionPathParams,
  ContributionIdPathParams,
  MyContributionsQuery,
  ReviewQueueQuery,
  RejectContributionBody,
  SubmitContributionResponse,
  ContributionListItemResponse,
  ContributionListResponse,
];

export * from './classes/index.js';
export * from './controllers/index.js';
export * from './services/index.js';
export * from './repositories/index.js';
export * from './types.js';
export * from './container.js';
