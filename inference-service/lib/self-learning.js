const fs = require('fs');
const path = require('path');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function defaultState(initialThreshold) {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    compare: {
      threshold: initialThreshold,
      feedback_count: 0,
      confusion: {
        true_positive: 0,
        false_positive: 0,
        true_negative: 0,
        false_negative: 0,
      },
      recent_feedback: [],
    },
  };
}

function readState(filePath, initialThreshold) {
  try {
    if (!fs.existsSync(filePath)) return defaultState(initialThreshold);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.compare || typeof parsed.compare !== 'object') {
      return defaultState(initialThreshold);
    }

    parsed.version = 1;
    parsed.compare.threshold = toFiniteNumber(parsed.compare.threshold, initialThreshold);
    parsed.compare.feedback_count = Number(parsed.compare.feedback_count || 0);
    parsed.compare.confusion = parsed.compare.confusion || {
      true_positive: 0,
      false_positive: 0,
      true_negative: 0,
      false_negative: 0,
    };
    parsed.compare.recent_feedback = Array.isArray(parsed.compare.recent_feedback)
      ? parsed.compare.recent_feedback.slice(-50)
      : [];
    parsed.updated_at = new Date().toISOString();
    return parsed;
  } catch {
    return defaultState(initialThreshold);
  }
}

function writeState(filePath, state) {
  ensureDirFor(filePath);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function createSelfLearningService(options = {}) {
  const enabled = options.enabled !== false;
  const minThreshold = toFiniteNumber(options.minThreshold, 0.65);
  const maxThreshold = toFiniteNumber(options.maxThreshold, 0.95);
  const learningRate = toFiniteNumber(options.learningRate, 0.025);
  const initialThreshold = clamp(toFiniteNumber(options.initialThreshold, 0.85), minThreshold, maxThreshold);
  const statePath = options.statePath || path.join(process.cwd(), 'data', 'self-learning-state.json');

  let state = readState(statePath, initialThreshold);
  state.compare.threshold = clamp(state.compare.threshold, minThreshold, maxThreshold);

  if (enabled) {
    writeState(statePath, state);
  }

  function getThreshold() {
    return clamp(state.compare.threshold, minThreshold, maxThreshold);
  }

  function getState() {
    return {
      enabled,
      state_path: statePath,
      min_threshold: minThreshold,
      max_threshold: maxThreshold,
      learning_rate: learningRate,
      ...state,
    };
  }

  function applyCompareFeedback(payload = {}) {
    const similarity = toFiniteNumber(payload.similarity, NaN);
    const actualSameVehicle = Boolean(payload.actual_same_vehicle);
    const context = payload.context && typeof payload.context === 'object' ? payload.context : {};

    if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) {
      throw new Error('similarity must be a number between 0 and 1');
    }

    const thresholdBefore = getThreshold();
    const predictedSame = similarity >= thresholdBefore;
    let thresholdAfter = thresholdBefore;

    if (enabled) {
      if (predictedSame && !actualSameVehicle) {
        state.compare.confusion.false_positive += 1;
        thresholdAfter = thresholdBefore + learningRate * Math.max(0.01, similarity - thresholdBefore);
      } else if (!predictedSame && actualSameVehicle) {
        state.compare.confusion.false_negative += 1;
        thresholdAfter = thresholdBefore - learningRate * Math.max(0.01, thresholdBefore - similarity);
      } else if (predictedSame && actualSameVehicle) {
        state.compare.confusion.true_positive += 1;
      } else {
        state.compare.confusion.true_negative += 1;
      }

      state.compare.threshold = clamp(thresholdAfter, minThreshold, maxThreshold);
      state.compare.feedback_count += 1;
      state.updated_at = new Date().toISOString();
      state.compare.recent_feedback.push({
        at: state.updated_at,
        similarity,
        predicted_same_vehicle: predictedSame,
        actual_same_vehicle: actualSameVehicle,
        threshold_before: thresholdBefore,
        threshold_after: state.compare.threshold,
        context,
      });
      state.compare.recent_feedback = state.compare.recent_feedback.slice(-50);
      writeState(statePath, state);
    }

    return {
      enabled,
      predicted_same_vehicle: predictedSame,
      actual_same_vehicle: actualSameVehicle,
      threshold_before: thresholdBefore,
      threshold_after: getThreshold(),
      confusion: state.compare.confusion,
      feedback_count: state.compare.feedback_count,
    };
  }

  return {
    enabled,
    getThreshold,
    getState,
    applyCompareFeedback,
  };
}

module.exports = { createSelfLearningService };
