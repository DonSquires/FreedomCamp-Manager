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
  const { radioRouter } = require('../radio-router.js');

  return {
    radioRouter,
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
