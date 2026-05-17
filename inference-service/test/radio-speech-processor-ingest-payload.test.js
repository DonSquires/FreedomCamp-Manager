const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../lib/radio-speech-processor');

test('buildIngestContractPayload maps rows/event to ingest contract shape', () => {
  const payload = __test.buildIngestContractPayload({
    event: {
      orgId: 'org-1',
      channelId: 'channel-alpha',
      transmissionId: 'tx-123',
      source: 'ptt-server.speech-worker',
      traceId: 'trace-999',
      provider: {
        name: 'mediasoup',
        pipeline: 'sfu-session-events',
        model: 'n/a',
      },
    },
    result: {
      provider: 'fieldops-railway-stt',
    },
    processingLatencyMs: 742,
    rows: [
      {
        sequence_num: 1,
        segment_start_ms: 0,
        segment_end_ms: 800,
        text: 'Unit 5 arrived on site.',
        language: 'en',
        confidence: 0.91,
        is_final: true,
      },
    ],
  });

  assert.equal(payload.orgId, 'org-1');
  assert.equal(payload.channelId, 'channel-alpha');
  assert.equal(payload.transmissionId, 'tx-123');
  assert.equal(payload.source, 'ptt-server.speech-worker');
  assert.equal(payload.provider.name, 'fieldops-railway-stt');
  assert.equal(payload.provider.requestId, 'trace-999');
  assert.equal(payload.provider.pipeline, 'sfu-session-events');
  assert.equal(payload.provider.latencyMs, 742);
  assert.equal(payload.segments.length, 1);
  assert.equal(payload.segments[0].sequenceNum, 1);
  assert.equal(payload.segments[0].segmentStartMs, 0);
  assert.equal(payload.segments[0].segmentEndMs, 800);
  assert.equal(payload.segments[0].text, 'Unit 5 arrived on site.');
  assert.equal(payload.segments[0].provider, 'fieldops-railway-stt');
});
