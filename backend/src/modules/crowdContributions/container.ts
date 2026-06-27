import 'reflect-metadata';
import {ContainerModule} from 'inversify';
import {CROWD_CONTRIBUTION_TYPES} from './types.js';
import {CrowdContributionService} from './services/CrowdContributionService.js';
import {AiJudgeService} from './services/AiJudgeService.js';
import {EmbeddingService} from './services/EmbeddingService.js';
import {SimilarityService} from './services/SimilarityService.js';
import {CrowdContributionRepository} from './repositories/providers/mongodb/CrowdContributionRepository.js';
import {CrowdContributionController} from './controllers/CrowdContributionController.js';

export const crowdContributionsContainerModule = new ContainerModule(options => {
  // Repository
  options.bind(CrowdContributionRepository).toSelf().inSingletonScope();
  options
    .bind(CROWD_CONTRIBUTION_TYPES.CrowdContributionRepo)
    .to(CrowdContributionRepository);

  // Services
  options.bind(EmbeddingService).toSelf().inSingletonScope();
  options
    .bind(CROWD_CONTRIBUTION_TYPES.EmbeddingService)
    .to(EmbeddingService);

  options.bind(SimilarityService).toSelf().inSingletonScope();
  options
    .bind(CROWD_CONTRIBUTION_TYPES.SimilarityService)
    .to(SimilarityService);

  options.bind(AiJudgeService).toSelf().inSingletonScope();
  options.bind(CROWD_CONTRIBUTION_TYPES.AiJudgeService).to(AiJudgeService);

  options.bind(CrowdContributionService).toSelf().inSingletonScope();
  options
    .bind(CROWD_CONTRIBUTION_TYPES.CrowdContributionService)
    .to(CrowdContributionService);

  // Controller
  options.bind(CrowdContributionController).toSelf().inSingletonScope();
});
