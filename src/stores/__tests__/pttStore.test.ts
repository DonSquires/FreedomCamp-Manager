import { describe, it, expect, beforeEach } from 'vitest'
import { usePTTStore, type PTTPresence, type PTTClip } from '../pttStore'

// Reset the store state before every test so tests are isolated
beforeEach(() => {
  usePTTStore.getState().reset()
})

// ── initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('connection is disconnected', () => {
    expect(usePTTStore.getState().connectionStatus).toBe('disconnected')
  })

  it('channel, speaker and presence are all null / empty', () => {
    const state = usePTTStore.getState()
    expect(state.channelId).toBeNull()
    expect(state.channelType).toBeNull()
    expect(state.channelName).toBeNull()
    expect(state.speakerId).toBeNull()
    expect(state.speakerName).toBeNull()
    expect(state.isSpeaking).toBe(false)
    expect(state.presence).toEqual([])
  })

  it('audio defaults', () => {
    const state = usePTTStore.getState()
    expect(state.isMuted).toBe(false)
    expect(state.audioEnabled).toBe(true)
    expect(state.audioLevel).toBe(0)
  })

  it('input mode defaults', () => {
    const state = usePTTStore.getState()
    expect(state.inputMode).toBe('ptt')
    expect(state.voxThreshold).toBe(30)
    expect(state.voxEnabled).toBe(false)
    expect(state.toggleState).toBe(false)
  })

  it('bluetooth defaults', () => {
    const state = usePTTStore.getState()
    expect(state.bluetoothEnabled).toBe(false)
    expect(state.bluetoothDevice).toBeNull()
    expect(state.bluetoothPttButtonPressed).toBe(false)
  })

  it('clips default', () => {
    const state = usePTTStore.getState()
    expect(state.lastClips).toEqual([])
    expect(state.maxClipsToKeep).toBe(10)
  })

  it('error is null', () => {
    expect(usePTTStore.getState().error).toBeNull()
  })
})

// ── setConnection ────────────────────────────────────────────────────────────

describe('setConnection', () => {
  it('updates connectionStatus', () => {
    usePTTStore.getState().setConnection('connecting')
    expect(usePTTStore.getState().connectionStatus).toBe('connecting')
  })

  it('sets wsUrl and token when provided', () => {
    usePTTStore.getState().setConnection('connected', 'wss://example.com', 'tok-123')
    const state = usePTTStore.getState()
    expect(state.wsUrl).toBe('wss://example.com')
    expect(state.token).toBe('tok-123')
  })

  it('clears error when status becomes "connected"', () => {
    usePTTStore.setState({ error: 'previous error' })
    usePTTStore.getState().setConnection('connected')
    expect(usePTTStore.getState().error).toBeNull()
  })

  it('does not clear error for non-connected statuses', () => {
    usePTTStore.setState({ error: 'previous error' })
    usePTTStore.getState().setConnection('reconnecting')
    expect(usePTTStore.getState().error).toBe('previous error')
  })
})

// ── setIceServers ────────────────────────────────────────────────────────────

describe('setIceServers', () => {
  it('stores the provided ICE servers', () => {
    const servers: RTCIceServer[] = [{ urls: 'stun:stun.example.com' }]
    usePTTStore.getState().setIceServers(servers)
    expect(usePTTStore.getState().iceServers).toEqual(servers)
  })
})

// ── setChannel ───────────────────────────────────────────────────────────────

describe('setChannel', () => {
  it('sets channelId, channelType and channelName', () => {
    usePTTStore.getState().setChannel('ch-1', 'org', 'Main Channel')
    const state = usePTTStore.getState()
    expect(state.channelId).toBe('ch-1')
    expect(state.channelType).toBe('org')
    expect(state.channelName).toBe('Main Channel')
  })

  it('resets presence, speaker and speaking state when channel changes', () => {
    usePTTStore.setState({
      presence: [{ userId: 'u1', name: 'Alice', role: 'officer', status: 'online' }],
      speakerId: 'u1',
      speakerName: 'Alice',
      isSpeaking: true,
    })
    usePTTStore.getState().setChannel('ch-2', 'team', 'Team Chat')
    const state = usePTTStore.getState()
    expect(state.presence).toEqual([])
    expect(state.speakerId).toBeNull()
    expect(state.speakerName).toBeNull()
    expect(state.isSpeaking).toBe(false)
  })

  it('sets channel to null to clear it', () => {
    usePTTStore.getState().setChannel('ch-1', 'org', 'Main Channel')
    usePTTStore.getState().setChannel(null)
    expect(usePTTStore.getState().channelId).toBeNull()
  })
})

// ── setSpeaking / setSpeaker ─────────────────────────────────────────────────

describe('setSpeaking', () => {
  it('sets isSpeaking to true', () => {
    usePTTStore.getState().setSpeaking(true)
    expect(usePTTStore.getState().isSpeaking).toBe(true)
  })

  it('sets isSpeaking to false', () => {
    usePTTStore.setState({ isSpeaking: true })
    usePTTStore.getState().setSpeaking(false)
    expect(usePTTStore.getState().isSpeaking).toBe(false)
  })
})

describe('setSpeaker', () => {
  it('sets speakerId and speakerName', () => {
    usePTTStore.getState().setSpeaker('u-1', 'Officer Bob')
    const state = usePTTStore.getState()
    expect(state.speakerId).toBe('u-1')
    expect(state.speakerName).toBe('Officer Bob')
  })

  it('clears speaker when null is passed', () => {
    usePTTStore.getState().setSpeaker('u-1', 'Bob')
    usePTTStore.getState().setSpeaker(null)
    expect(usePTTStore.getState().speakerId).toBeNull()
    expect(usePTTStore.getState().speakerName).toBeNull()
  })
})

// ── presence management ──────────────────────────────────────────────────────

describe('presence management', () => {
  const alice: PTTPresence = { userId: 'u-1', name: 'Alice', role: 'officer', status: 'online' }
  const bob: PTTPresence = { userId: 'u-2', name: 'Bob', role: 'admin', status: 'online' }

  it('setPresence replaces the entire list', () => {
    usePTTStore.getState().setPresence([alice])
    usePTTStore.getState().setPresence([bob])
    expect(usePTTStore.getState().presence).toEqual([bob])
  })

  it('setPresence removes duplicate and invalid user ids', () => {
    const duplicateAlice: PTTPresence = { ...alice, status: 'busy' }
    const invalidUser = { userId: '   ', name: 'Ghost', role: 'officer', status: 'online' } as PTTPresence

    usePTTStore.getState().setPresence([alice, duplicateAlice, invalidUser, bob])

    expect(usePTTStore.getState().presence).toEqual([alice, bob])
    expect(usePTTStore.getState().presence[0]?.status).toBe('online')
    expect(usePTTStore.getState().presence[1]?.userId).toBe('u-2')
  })

  it('addPresence adds a new user', () => {
    usePTTStore.getState().addPresence(alice)
    expect(usePTTStore.getState().presence).toHaveLength(1)
    expect(usePTTStore.getState().presence[0]).toEqual(alice)
  })

  it('addPresence updates an existing user instead of duplicating', () => {
    usePTTStore.getState().addPresence(alice)
    const updated = { ...alice, status: 'busy' as const }
    usePTTStore.getState().addPresence(updated)
    const presence = usePTTStore.getState().presence
    expect(presence).toHaveLength(1)
    expect(presence[0].status).toBe('busy')
  })

  it('removePresence removes a user by userId', () => {
    usePTTStore.getState().setPresence([alice, bob])
    usePTTStore.getState().removePresence('u-1')
    const presence = usePTTStore.getState().presence
    expect(presence).toHaveLength(1)
    expect(presence[0].userId).toBe('u-2')
  })

  it('removePresence does nothing if userId not found', () => {
    usePTTStore.getState().setPresence([alice])
    usePTTStore.getState().removePresence('u-999')
    expect(usePTTStore.getState().presence).toHaveLength(1)
  })

  it('updatePresenceStatus updates status for a user', () => {
    usePTTStore.getState().setPresence([alice, bob])
    usePTTStore.getState().updatePresenceStatus('u-1', 'offshift')
    const updated = usePTTStore.getState().presence.find((p) => p.userId === 'u-1')
    expect(updated?.status).toBe('offshift')
  })

  it('updatePresenceStatus leaves other users unchanged', () => {
    usePTTStore.getState().setPresence([alice, bob])
    usePTTStore.getState().updatePresenceStatus('u-1', 'busy')
    const bobEntry = usePTTStore.getState().presence.find((p) => p.userId === 'u-2')
    expect(bobEntry?.status).toBe('online')
  })
})

// ── audio ────────────────────────────────────────────────────────────────────

describe('audio controls', () => {
  it('setMuted toggles mute state', () => {
    usePTTStore.getState().setMuted(true)
    expect(usePTTStore.getState().isMuted).toBe(true)
    usePTTStore.getState().setMuted(false)
    expect(usePTTStore.getState().isMuted).toBe(false)
  })

  it('setAudioEnabled toggles audio', () => {
    usePTTStore.getState().setAudioEnabled(false)
    expect(usePTTStore.getState().audioEnabled).toBe(false)
  })

  it('setAudioLevel clamps to 0–100', () => {
    usePTTStore.getState().setAudioLevel(150)
    expect(usePTTStore.getState().audioLevel).toBe(100)
    usePTTStore.getState().setAudioLevel(-10)
    expect(usePTTStore.getState().audioLevel).toBe(0)
  })

  it('setAudioLevel accepts values within range', () => {
    usePTTStore.getState().setAudioLevel(55)
    expect(usePTTStore.getState().audioLevel).toBe(55)
  })
})

// ── input mode ───────────────────────────────────────────────────────────────

describe('input mode', () => {
  it('setInputMode changes mode and resets toggleState', () => {
    usePTTStore.setState({ toggleState: true })
    usePTTStore.getState().setInputMode('vox')
    const state = usePTTStore.getState()
    expect(state.inputMode).toBe('vox')
    expect(state.toggleState).toBe(false)
  })

  it('setVoxThreshold clamps to 0–100', () => {
    usePTTStore.getState().setVoxThreshold(200)
    expect(usePTTStore.getState().voxThreshold).toBe(100)
    usePTTStore.getState().setVoxThreshold(-5)
    expect(usePTTStore.getState().voxThreshold).toBe(0)
  })

  it('setVoxEnabled enables VOX', () => {
    usePTTStore.getState().setVoxEnabled(true)
    expect(usePTTStore.getState().voxEnabled).toBe(true)
  })

  it('setToggleState changes toggle', () => {
    usePTTStore.getState().setToggleState(true)
    expect(usePTTStore.getState().toggleState).toBe(true)
  })
})

// ── bluetooth ────────────────────────────────────────────────────────────────

describe('bluetooth', () => {
  it('setBluetoothEnabled enables bluetooth', () => {
    usePTTStore.getState().setBluetoothEnabled(true)
    expect(usePTTStore.getState().bluetoothEnabled).toBe(true)
  })

  it('setBluetoothDevice stores device info', () => {
    const device = { id: 'bt-1', name: 'Headset', connected: true, batteryLevel: 80 }
    usePTTStore.getState().setBluetoothDevice(device)
    expect(usePTTStore.getState().bluetoothDevice).toEqual(device)
  })

  it('setBluetoothDevice accepts null (disconnected)', () => {
    usePTTStore.getState().setBluetoothDevice(null)
    expect(usePTTStore.getState().bluetoothDevice).toBeNull()
  })

  it('setBluetoothPttButtonPressed sets pressed state', () => {
    usePTTStore.getState().setBluetoothPttButtonPressed(true)
    expect(usePTTStore.getState().bluetoothPttButtonPressed).toBe(true)
  })
})

// ── clips ────────────────────────────────────────────────────────────────────

describe('addClip', () => {
  const makeClip = (id: string): PTTClip => ({
    id,
    senderId: 'u-1',
    senderName: 'Alice',
    channelId: 'ch-1',
    duration: 3,
    createdAt: new Date().toISOString(),
  })

  it('adds a clip to the front of lastClips', () => {
    const clip = makeClip('clip-1')
    usePTTStore.getState().addClip(clip)
    expect(usePTTStore.getState().lastClips[0]).toEqual(clip)
  })

  it('respects maxClipsToKeep (default 10)', () => {
    for (let i = 0; i < 12; i++) {
      usePTTStore.getState().addClip(makeClip(`clip-${i}`))
    }
    expect(usePTTStore.getState().lastClips).toHaveLength(10)
  })

  it('most recent clip is first', () => {
    usePTTStore.getState().addClip(makeClip('clip-old'))
    usePTTStore.getState().addClip(makeClip('clip-new'))
    expect(usePTTStore.getState().lastClips[0].id).toBe('clip-new')
  })
})

// ── error ─────────────────────────────────────────────────────────────────────

describe('setError', () => {
  it('sets the error message', () => {
    usePTTStore.getState().setError('Connection failed')
    expect(usePTTStore.getState().error).toBe('Connection failed')
  })

  it('clears the error when null is passed', () => {
    usePTTStore.setState({ error: 'some error' })
    usePTTStore.getState().setError(null)
    expect(usePTTStore.getState().error).toBeNull()
  })
})

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('restores all fields to initial values', () => {
    usePTTStore.setState({
      connectionStatus: 'connected',
      channelId: 'ch-1',
      isMuted: true,
      error: 'test',
    })
    usePTTStore.getState().reset()
    const state = usePTTStore.getState()
    expect(state.connectionStatus).toBe('disconnected')
    expect(state.channelId).toBeNull()
    expect(state.isMuted).toBe(false)
    expect(state.error).toBeNull()
  })
})
