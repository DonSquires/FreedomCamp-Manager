const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Module = require('node:module');

function withRedisModuleStub() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'redis') {
      return {
        createClient() {
          return {
            on() {},
            async connect() {},
            async lLen() { return 0; },
            async rPush() { return 1; },
          };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return () => {
    Module._load = originalLoad;
  };
}

function withFreshRadioRouter(envOverrides = {}) {
  const original = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    original[key] = process.env[key];
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const modulePath = require.resolve('../radio-router.js');
  delete require.cache[modulePath];
  const radioRouterModule = require('../radio-router.js');
  const { radioRouter } = radioRouterModule;

  return {
    radioRouter,
    radioRouterModule,
    restore() {
      for (const [key, prev] of Object.entries(original)) {
        if (typeof prev === 'undefined') {
          delete process.env[key];
        } else {
          process.env[key] = prev;
        }
      }
      delete require.cache[modulePath];
    },
  };
}

test('GET /radio/health includes speech queue and processor schema', async () => {
  const restoreRedisStub = withRedisModuleStub();
  const { radioRouter, restore } = withFreshRadioRouter({
    REDIS_URL: '',
    RADIO_SPEECH_METRICS_URL: '',
  });

  const app = express();
  app.use(express.json());
  app.use('/', radioRouter);

  const server = app.listen(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/radio/health`);
    assert.equal(response.status, 200);

    const payload = await response.json();

    assert.equal(typeof payload.sfuReady, 'boolean');
    assert.equal(typeof payload.workerCount, 'number');
    assert.equal(typeof payload.activeSessions, 'number');
    assert.equal(typeof payload.totalRouters, 'number');

    assert.ok(payload.speechQueue);
    assert.equal(typeof payload.speechQueue.enabled, 'boolean');
    assert.equal(typeof payload.speechQueue.ready, 'boolean');
    assert.equal(typeof payload.speechQueue.queueKey, 'string');
    assert.equal(typeof payload.speechQueue.dlqKey, 'string');
    assert.ok(payload.speechQueue.metrics);
    assert.equal(typeof payload.speechQueue.metrics.eventsEnqueued, 'number');
    assert.equal(typeof payload.speechQueue.metrics.enqueueFailures, 'number');

    assert.ok(payload.speechProcessor);
    assert.equal(typeof payload.speechProcessor.enabled, 'boolean');
    assert.equal(typeof payload.speechProcessor.ready, 'boolean');
    assert.ok(['not_configured', 'online', 'offline', 'http_error'].includes(String(payload.speechProcessor.status || '')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
    restoreRedisStub();
  }
});

test('GET /radio/health reports online speechProcessor when metrics endpoint succeeds', async () => {
  const restoreRedisStub = withRedisModuleStub();
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (url === 'https://example.test/radio/speech-metrics') {
      return {
        ok: true,
        async json() {
          return {
            generated_at: '2026-05-03T00:00:00.000Z',
            radio_pipeline: {
              processor_enabled: true,
              processor_mode: 'stub',
              metrics: { processed_events: 2, failed_events: 0 },
            },
          };
        },
      };
    }
    return originalFetch(input, init);
  };

  const { radioRouter, restore } = withFreshRadioRouter({
    REDIS_URL: '',
    RADIO_SPEECH_METRICS_URL: 'https://example.test/radio/speech-metrics',
    RADIO_SPEECH_METRICS_API_KEY: 'test-key',
  });

  const app = express();
  app.use(express.json());
  app.use('/', radioRouter);

  const server = app.listen(0);

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/radio/health`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.ok(payload.speechProcessor);
    assert.equal(payload.speechProcessor.enabled, true);
    assert.equal(payload.speechProcessor.ready, true);
    assert.equal(payload.speechProcessor.status, 'online');
    assert.equal(payload.speechProcessor.metricsUrl, 'https://example.test/radio/speech-metrics');
    assert.ok(payload.speechProcessor.radioPipeline);
    assert.equal(payload.speechProcessor.radioPipeline.processor_enabled, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
    restoreRedisStub();
    global.fetch = originalFetch;
  }
});

test('speech queue metrics track enqueue success and failure', async () => {
  const restoreRedisStub = withRedisModuleStub();
  const { radioRouterModule, restore } = withFreshRadioRouter({
    REDIS_URL: 'redis://example.test:6379',
    RADIO_SPEECH_METRICS_URL: '',
  });

  const { __test } = radioRouterModule;
  __test.resetSpeechQueueMetrics();

  __test.setRedisClientForTests({
    async rPush() { return 1; },
    async lLen() { return 0; },
  });
  __test.setRedisReadyForTests(true);

  await __test.enqueueSpeechEvent({ type: 'radio.producer.created', transmissionId: 'tx-success' });
  let health = await __test.getSpeechQueueHealth();
  assert.equal(health.metrics.eventsEnqueued, 1);
  assert.equal(health.metrics.enqueueFailures, 0);
  assert.equal(typeof health.metrics.lastEnqueuedAt, 'string');

  __test.setRedisClientForTests({
    async rPush() { throw new Error('redis write failed'); },
    async lLen() { return 0; },
  });

  await __test.enqueueSpeechEvent({ type: 'radio.session.closed', transmissionId: 'tx-failure' });
  health = await __test.getSpeechQueueHealth();
  assert.equal(health.metrics.eventsEnqueued, 1);
  assert.equal(health.metrics.enqueueFailures, 1);
  assert.equal(health.metrics.lastEnqueueError, 'redis write failed');

  __test.setRedisClientForTests(null);
  __test.setRedisReadyForTests(false);
  restore();
  restoreRedisStub();
});
