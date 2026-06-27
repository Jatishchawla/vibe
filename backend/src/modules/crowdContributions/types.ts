const CROWD_CONTRIBUTION_TYPES = {
  CrowdContributionService: Symbol.for('CrowdContributionService'),
  CrowdContributionRepo: Symbol.for('CrowdContributionRepo'),
  AiJudgeService: Symbol.for('CrowdAiJudgeService'),
  EmbeddingService: Symbol.for('CrowdEmbeddingService'),
  SimilarityService: Symbol.for('CrowdSimilarityService'),
};

export {CROWD_CONTRIBUTION_TYPES};
