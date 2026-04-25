const test = require('node:test');
const assert = require('node:assert/strict');

const pttServer = require('../server.js');

function createRedisMock() {
  const store = new Map();

  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, value);
      return 'OK';
    },
    async del(key) {
      store.delete(key);
      return 1;
    },
    dump(key) {
      return store.get(key);
    },
  };
}

test.afterEach(() => {
  pttServer.__test.resetState();
  pttServer.__test.setRedisMockClientForTests(null);
});

test('disconnectUserSession returns deny_only when no active presence exists', async () => {
  const result = await pttServer.__test.disconnectUserSession('user-deny-only', 'admin_forced_disconnect');

  assert.equal(result.disconnected, true);
  assert.equal(result.mode, 'deny_only');
  assert.equal(typeof result.retryAfterSeconds, 'number');
  assert.ok(result.retryAfterSeconds >= 1);

  const denyState = await pttServer.__test.getActiveDenyState('user-deny-only');
  assert.ok(denyState);
  assert.equal(denyState.reason, 'admin_forced_disconnect');
});

test('getActiveDenyState rehydrates deny state from Redis when local memory is cleared', async () => {
  const redisMock = createRedisMock();
  pttServer.__test.setRedisMockClientForTests(redisMock);

  await pttServer.__test.markUserTemporarilyDenied('user-redis-rehydrate', 'admin_forced_disconnect', 30_000);

  const persisted = redisMock.dump('ptt:deny:user-redis-rehydrate');
  assert.ok(persisted, 'deny state should be persisted to redis');

  pttServer.__test.forcedDisconnectDenyList.clear();

  const denyState = await pttServer.__test.getActiveDenyState('user-redis-rehydrate');
  assert.ok(denyState, 'deny state should rehydrate from redis');
  assert.equal(denyState.reason, 'admin_forced_disconnect');
  assert.ok(denyState.retryAfterSeconds >= 1);
});