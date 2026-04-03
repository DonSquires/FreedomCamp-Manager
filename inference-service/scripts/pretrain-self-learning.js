const path = require('path');
const { createSelfLearningService } = require('../lib/self-learning');
const { profileExamples } = require('../lib/pretrain-profiles');

const SELF_LEARNING_ENABLED = !['0', 'false', 'no', 'off'].includes((process.env.SELF_LEARNING_ENABLED || 'true').toLowerCase());
const STATE_PATH = process.env.SELF_LEARNING_STATE_PATH || path.join(process.cwd(), 'data', 'self-learning-state.json');
const PROFILE = (process.env.SELF_LEARNING_PRETRAIN_PROFILE || 'nz-enforcement-v1').toLowerCase();
const SAMPLE_MULTIPLIER = Math.max(1, Number(process.env.SELF_LEARNING_PRETRAIN_MULTIPLIER || 12));
const INITIAL_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD || 0.85);
const MIN_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD_MIN || 0.65);
const MAX_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD_MAX || 0.95);
const LEARNING_RATE = Number(process.env.SELF_LEARNING_RATE || 0.025);

function runPretraining() {
  const learner = createSelfLearningService({
    enabled: SELF_LEARNING_ENABLED,
    statePath: STATE_PATH,
    initialThreshold: INITIAL_THRESHOLD,
    minThreshold: MIN_THRESHOLD,
    maxThreshold: MAX_THRESHOLD,
    learningRate: LEARNING_RATE,
  });

  if (!SELF_LEARNING_ENABLED) {
    console.log('Self-learning disabled; skipping pretraining.');
    return;
  }

  const examples = profileExamples(PROFILE);
  const total = examples.length * SAMPLE_MULTIPLIER;

  for (let i = 0; i < SAMPLE_MULTIPLIER; i++) {
    for (const ex of examples) {
      learner.applyCompareFeedback({
        similarity: ex.similarity,
        actual_same_vehicle: ex.actual,
        context: {
          source: 'pretrain',
          profile: PROFILE,
        },
      });
    }
  }

  const state = learner.getState();
  console.log(`Pretraining complete: profile=${PROFILE}`);
  console.log(`State path: ${STATE_PATH}`);
  console.log(`Samples applied: ${total}`);
  console.log(`Threshold now: ${state.compare.threshold.toFixed(4)}`);
}

runPretraining();
