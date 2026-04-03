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
    advisory: {
      feedback_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      min_confidence_guidance: {
        vehicle_detection: 0.72,
        embedding_quality: 0.45,
        face_detection: 0.6,
        alpr_ocr: 0.65,
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

    parsed.advisory = parsed.advisory || {
      feedback_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      min_confidence_guidance: {
        vehicle_detection: 0.72,
        embedding_quality: 0.45,
        face_detection: 0.6,
        alpr_ocr: 0.65,
      },
      recent_feedback: [],
    };
    parsed.advisory.feedback_count = Number(parsed.advisory.feedback_count || 0);
    parsed.advisory.correct_count = Number(parsed.advisory.correct_count || 0);
    parsed.advisory.incorrect_count = Number(parsed.advisory.incorrect_count || 0);
    parsed.advisory.min_confidence_guidance = {
      vehicle_detection: clamp(toFiniteNumber(parsed.advisory.min_confidence_guidance?.vehicle_detection, 0.72), 0.3, 0.99),
      embedding_quality: clamp(toFiniteNumber(parsed.advisory.min_confidence_guidance?.embedding_quality, 0.45), 0.2, 0.99),
      face_detection: clamp(toFiniteNumber(parsed.advisory.min_confidence_guidance?.face_detection, 0.6), 0.2, 0.99),
      alpr_ocr: clamp(toFiniteNumber(parsed.advisory.min_confidence_guidance?.alpr_ocr, 0.65), 0.2, 0.99),
    };
    parsed.advisory.recent_feedback = Array.isArray(parsed.advisory.recent_feedback)
      ? parsed.advisory.recent_feedback.slice(-80)
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

  function applyOperationalFeedback(payload = {}) {
    const pipeline = String(payload.pipeline || 'unknown').trim().toLowerCase().slice(0, 64) || 'unknown';
    const wasCorrect = typeof payload.was_correct === 'boolean' ? payload.was_correct : null;
    const confidence = toFiniteNumber(payload.confidence, NaN);
    const context = payload.context && typeof payload.context === 'object' ? payload.context : {};

    if (!enabled) {
      return {
        enabled,
        pipeline,
        stored: false,
        guidance: state.advisory.min_confidence_guidance,
      };
    }

    const guidanceKey = pipeline === 'vehicle_infer'
      ? 'vehicle_detection'
      : pipeline === 'face_infer'
        ? 'face_detection'
        : pipeline === 'embedding'
          ? 'embedding_quality'
          : pipeline === 'alpr'
            ? 'alpr_ocr'
            : null;

    if (wasCorrect === true) state.advisory.correct_count += 1;
    if (wasCorrect === false) state.advisory.incorrect_count += 1;
    state.advisory.feedback_count += 1;

    if (guidanceKey && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 && wasCorrect !== null) {
      const current = state.advisory.min_confidence_guidance[guidanceKey];
      let next = current;

      if (wasCorrect === false && confidence >= current) {
        next = current + (learningRate * Math.max(0.01, confidence - current));
      } else if (wasCorrect === true && confidence < current) {
        next = current - (learningRate * Math.max(0.01, current - confidence) * 0.5);
      }

      state.advisory.min_confidence_guidance[guidanceKey] = clamp(next, 0.2, 0.99);
    }

    state.updated_at = new Date().toISOString();
    state.advisory.recent_feedback.push({
      at: state.updated_at,
      pipeline,
      confidence: Number.isFinite(confidence) ? confidence : null,
      was_correct: wasCorrect,
      context,
    });
    state.advisory.recent_feedback = state.advisory.recent_feedback.slice(-80);
    writeState(statePath, state);

    const evaluated = state.advisory.correct_count + state.advisory.incorrect_count;
    const accuracy = evaluated > 0 ? state.advisory.correct_count / evaluated : null;

    return {
      enabled,
      pipeline,
      stored: true,
      guidance: state.advisory.min_confidence_guidance,
      feedback_count: state.advisory.feedback_count,
      evaluated_feedback_count: evaluated,
      observed_accuracy: accuracy,
    };
  }

  return {
    enabled,
    getThreshold,
    getState,
    applyCompareFeedback,
    applyOperationalFeedback,
  };
}

module.exports = { createSelfLearningService };
