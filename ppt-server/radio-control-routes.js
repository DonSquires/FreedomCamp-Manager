/**
 * Radio Control Plane Routes
 * 
 * Endpoints for floor arbitration, presence management, and transission state.
 * - POST /control/floor-request
 * - POST /control/floor-grant
 * - POST /control/floor-deny
 * - POST /control/emergency-override
 * - POST /control/floor-release
 * - GET /control/floor-state
 * 
 * All endpoints validate JWT tokens issued by Edge Function (radio-token).
 */

const express = require('express');
const { FloorControlManager, redis } = require('./floor-control');

const router = express.Router();
const floorControl = new FloorControlManager(redis);

/**
 * Middleware: verify JWT token from radio-token Edge Function
 * Expected token payload: { sub, org, role, channel_scope, channel_type, transmission_id, exp }
 */
function verifyRadioToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' });
  }

  const token = authHeader.substring(7);

  // In production, verify JWT signature with shared secret or key.
  // For now, decode and validate expiry.
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64'));
    if (payload.exp * 1000 < Date.now()) {
      return res.status(401).json({ error: 'Token expired' });
    }
    req.token = payload;
    req.orgId = payload.org;
    req.userId = payload.sub;
    req.role = payload.role;
    req.channelScope = payload.channel_scope;
    req.transmissionId = payload.transmission_id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token', detail: err.message });
  }
}

router.use(verifyRadioToken);

/**
 * POST /control/floor-request
 * Request floor to speak on channel
 */
router.post('/floor-request', async (req, res) => {
  try {
    const { channel_id } = req.body;
    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    const result = await floorControl.requestFloor(
      req.orgId,
      channel_id,
      req.userId,
      req.role
    );

    res.json({
      approved: result.approved,
      message: result.message,
      channel_id,
      transmission_id: req.transmissionId,
    });
  } catch (err) {
    console.error('[floor-request] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /control/floor-grant
 * Admin grants floor to officer (requires admin_officer or master role)
 */
router.post('/floor-grant', async (req, res) => {
  try {
    const { channel_id, speaker_id } = req.body;

    // Authorization: only admin roles can grant floor
    if (!['admin', 'admin_officer', 'master', 'grand_master'].includes(req.role)) {
      return res.status(403).json({ error: 'Insufficient role to grant floor' });
    }

    if (!channel_id || !speaker_id) {
      return res.status(400).json({ error: 'channel_id and speaker_id are required' });
    }

    const result = await floorControl.grantFloor(
      req.orgId,
      channel_id,
      speaker_id,
      'officer'
    );

    res.json({
      approved: result.approved,
      message: result.message,
      channel_id,
      speaker_id,
    });
  } catch (err) {
    console.error('[floor-grant] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /control/floor-deny
 * Admin denies floor request for officer
 */
router.post('/floor-deny', async (req, res) => {
  try {
    const { channel_id, speaker_id, reason } = req.body;

    // Authorization: only admin roles
    if (!['admin', 'admin_officer', 'master', 'grand_master'].includes(req.role)) {
      return res.status(403).json({ error: 'Insufficient role to deny floor' });
    }

    if (!channel_id || !speaker_id) {
      return res.status(400).json({ error: 'channel_id and speaker_id are required' });
    }

    const result = await floorControl.denyFloor(
      req.orgId,
      channel_id,
      speaker_id,
      reason || 'Denied by admin'
    );

    res.json({
      approved: result.approved,
      message: result.message,
      channel_id,
      speaker_id,
    });
  } catch (err) {
    console.error('[floor-deny] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /control/floor-release
 * Speaker releases floor (stops transmitting)
 */
router.post('/floor-release', async (req, res) => {
  try {
    const { channel_id } = req.body;
    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    const result = await floorControl.releaseFloor(
      req.orgId,
      channel_id,
      req.userId
    );

    if (!result.approved) {
      return res.status(403).json({ error: result.message });
    }

    res.json({
      approved: result.approved,
      message: result.message,
      channel_id,
    });
  } catch (err) {
    console.error('[floor-release] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /control/emergency-override
 * Master/Grand Master revokes floor and takes control (emergency)
 */
router.post('/emergency-override', async (req, res) => {
  try {
    const { channel_id, reason } = req.body;

    // Authorization: only master+ roles
    if (!['master', 'grand_master'].includes(req.role)) {
      return res.status(403).json({ error: 'Insufficient role for emergency override' });
    }

    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    const result = await floorControl.emergencyOverride(
      req.orgId,
      channel_id,
      req.userId,
      reason || 'Emergency override'
    );

    res.json({
      approved: result.approved,
      message: result.message,
      channel_id,
      admin_id: req.userId,
    });
  } catch (err) {
    console.error('[emergency-override] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /control/floor-state
 * Get current floor state for a channel
 */
router.get('/floor-state', async (req, res) => {
  try {
    const { channel_id } = req.query;
    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id query param is required' });
    }

    const state = await floorControl.getFloorState(req.orgId, channel_id);

    res.json({
      channel_id,
      floor_state: state,
    });
  } catch (err) {
    console.error('[floor-state] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
