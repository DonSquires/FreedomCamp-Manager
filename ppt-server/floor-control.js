/**
 * Floor Control and Arbitration Module
 * 
 * Implements PTT radio floor control semantics: one speaker per channel at a time.
 * - Handles floor requests, grants, denials, and emergency overrides.
 * - Uses Redis pub/sub for real-time presence and floor events.
 * - Per-channel floor arbitration via simple queue (first-come, first-served).
 * 
 * Per ADR 003 (PTT Service Topology) and ADR 008 (Event Backbone).
 */

const Redis = require('redis');
const jwt = require('jsonwebtoken');

const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Constants
const FLOOR_TIMEOUT_MS = 30000; // 30 seconds: timeout for stuck floor grants
const FLOOR_REQUEST_QUEUE_MAX = 10; // Max pending requests per channel

/**
 * Floor State Manager
 * Tracks: active speaker, pending requests, presence per channel
 */
class FloorControlManager {
  constructor(redisClient) {
    this.redis = redisClient;
    this.floorState = new Map(); // channelId → { speakerId, startedAt, isEmergency }
    this.floorQueues = new Map(); // channelId → [{ requesterId, requestedAt, role }]
    this.presenceState = new Map(); // channelId → Set of online officer IDs
  }

  /**
   * Request floor: add speaker to queue
   * @param {string} orgId - Organization ID
   * @param {string} channelId - Channel ID
   * @param {string} speakerId - Officer requesting
   * @param {string} role - Officer role (officer, admin_officer, master)
   * @returns {Promise<{approved: boolean, message: string}>}
   */
  async requestFloor(orgId, channelId, speakerId, role) {
    const key = `radio:org:${orgId}:channel:${channelId}`;
    const queueKey = `${key}:floor:queue`;
    const stateKey = `${key}:floor:state`;

    // Check if already speaking
    const state = await this.redis.hGetAll(stateKey);
    if (state && state.speaker_id === speakerId) {
      return { approved: false, message: 'Already speaking' };
    }

    // Check queue size
    const queueLen = await this.redis.lLen(queueKey);
    if (queueLen >= FLOOR_REQUEST_QUEUE_MAX) {
      return { approved: false, message: 'Floor queue full' };
    }

    // Add to queue
    const request = {
      requester_id: speakerId,
      requested_at: Date.now(),
      role,
    };
    await this.redis.rPush(queueKey, JSON.stringify(request));

    // Publish floor request event
    await this.redis.publish(
      `${key}:floor:events`,
      JSON.stringify({
        event: 'floor_request',
        requester_id: speakerId,
        timestamp: Date.now(),
      })
    );

    // If no active speaker, grant immediately
    if (!state || !state.speaker_id) {
      return this.grantFloor(orgId, channelId, speakerId, role);
    }

    return { approved: false, message: 'Queued for floor' };
  }

  /**
   * Grant floor to next requester (or specific officer)
   * @param {string} orgId
   * @param {string} channelId
   * @param {string} speakerId - Officer to grant floor to
   * @param {string} role - Officer role
   * @returns {Promise<{approved: boolean, message: string}>}
   */
  async grantFloor(orgId, channelId, speakerId, role) {
    const key = `radio:org:${orgId}:channel:${channelId}`;
    const stateKey = `${key}:floor:state`;
    const queueKey = `${key}:floor:queue`;

    // Check current state
    const state = await this.redis.hGetAll(stateKey);
    if (state && state.speaker_id && Date.now() - parseInt(state.floor_granted_at) < 1000) {
      // Someone else just got the floor; reject
      return { approved: false, message: 'Floor already granted' };
    }

    // Remove from queue if present
    const queue = await this.redis.lRange(queueKey, 0, -1);
    const queueIndex = queue.findIndex(
      (item) => JSON.parse(item).requester_id === speakerId
    );
    if (queueIndex >= 0) {
      await this.redis.lRem(queueKey, 1, queue[queueIndex]);
    }

    // Set floor state
    const grantedAt = Date.now();
    await this.redis.hSet(stateKey, {
      speaker_id: speakerId,
      floor_granted_at: grantedAt,
      is_emergency: '0',
    });

    // Publish floor granted event
    await this.redis.publish(
      `${key}:floor:events`,
      JSON.stringify({
        event: 'floor_granted',
        speaker_id: speakerId,
        granted_at: grantedAt,
        timestamp: Date.now(),
      })
    );

    return { approved: true, message: 'Floor granted' };
  }

  /**
   * Deny floor request
   * @param {string} orgId
   * @param {string} channelId
   * @param {string} speakerId
   * @param {string} reason
   * @returns {Promise<{approved: boolean, message: string}>}
   */
  async denyFloor(orgId, channelId, speakerId, reason = 'Denied by admin') {
    const key = `radio:org:${orgId}:channel:${channelId}`;
    const queueKey = `${key}:floor:queue`;

    // Remove from queue
    const queue = await this.redis.lRange(queueKey, 0, -1);
    const item = queue.find((q) => JSON.parse(q).requester_id === speakerId);
    if (item) {
      await this.redis.lRem(queueKey, 1, item);
    }

    // Publish denial event
    await this.redis.publish(
      `${key}:floor:events`,
      JSON.stringify({
        event: 'floor_denied',
        speaker_id: speakerId,
        reason,
        timestamp: Date.now(),
      })
    );

    return { approved: true, message: 'Floor request denied' };
  }

  /**
   * Release floor (speaker stops transmitting)
   * @param {string} orgId
   * @param {string} channelId
   * @param {string} speakerId
   * @returns {Promise<{approved: boolean, message: string}>}
   */
  async releaseFloor(orgId, channelId, speakerId) {
    const key = `radio:org:${orgId}:channel:${channelId}`;
    const stateKey = `${key}:floor:state`;
    const queueKey = `${key}:floor:queue`;

    // Verify current speaker
    const state = await this.redis.hGetAll(stateKey);
    if (state && state.speaker_id !== speakerId) {
      return { approved: false, message: 'Not current speaker' };
    }

    // Clear floor state
    await this.redis.del(stateKey);

    // Publish floor released event
    await this.redis.publish(
      `${key}:floor:events`,
      JSON.stringify({
        event: 'floor_released',
        speaker_id: speakerId,
        timestamp: Date.now(),
      })
    );

    // Grant next in queue (if any)
    const queue = await this.redis.lRange(queueKey, 0, 0);
    if (queue && queue.length > 0) {
      const nextRequest = JSON.parse(queue[0]);
      await this.grantFloor(orgId, channelId, nextRequest.requester_id, nextRequest.role);
    }

    return { approved: true, message: 'Floor released' };
  }

  /**
   * Emergency override: force floor to admin
   * @param {string} orgId
   * @param {string} channelId
   * @param {string} adminId - Admin ID
   * @param {string} reason
   * @returns {Promise<{approved: boolean, message: string}>}
   */
  async emergencyOverride(orgId, channelId, adminId, reason = 'Emergency override') {
    const key = `radio:org:${orgId}:channel:${channelId}`;
    const stateKey = `${key}:floor:state`;
    const queueKey = `${key}:floor:queue`;

    // Revoke current speaker's floor
    const state = await this.redis.hGetAll(stateKey);
    if (state && state.speaker_id) {
      await this.redis.publish(
        `${key}:floor:events`,
        JSON.stringify({
          event: 'floor_revoked',
          speaker_id: state.speaker_id,
          reason: 'Emergency override by admin',
          timestamp: Date.now(),
        })
      );
    }

    // Clear queue
    await this.redis.del(queueKey);

    // Grant floor to admin
    const grantedAt = Date.now();
    await this.redis.hSet(stateKey, {
      speaker_id: adminId,
      floor_granted_at: grantedAt,
      is_emergency: '1',
    });

    // Publish emergency override event
    await this.redis.publish(
      `${key}:floor:events`,
      JSON.stringify({
        event: 'floor_emergency_override',
        admin_id: adminId,
        reason,
        granted_at: grantedAt,
        timestamp: Date.now(),
      })
    );

    return { approved: true, message: 'Emergency override granted' };
  }

  /**
   * Get current floor state
   * @param {string} orgId
   * @param {string} channelId
   * @returns {Promise<{speaker_id, granted_at, is_emergency, queue: []}>}
   */
  async getFloorState(orgId, channelId) {
    const key = `radio:org:${orgId}:channel:${channelId}`;
    const stateKey = `${key}:floor:state`;
    const queueKey = `${key}:floor:queue`;

    const state = await this.redis.hGetAll(stateKey);
    const queue = await this.redis.lRange(queueKey, 0, -1);

    return {
      speaker_id: state?.speaker_id || null,
      granted_at: state?.floor_granted_at ? parseInt(state.floor_granted_at) : null,
      is_emergency: state?.is_emergency === '1',
      queue: queue.map((q) => JSON.parse(q)),
    };
  }
}

module.exports = { FloorControlManager, redis };
