const base = 'http://127.0.0.1:3102';
const wsBase = 'ws://127.0.0.1:3102/ws';

const u1 = '11111111-1111-1111-1111-111111111111';
const u2 = '22222222-2222-4222-8222-222222222222';
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const channel = ['direct', ...[u1, u2].sort()].join(':');

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function mint(userId, firstName){
  const res = await fetch(`${base}/api/token/mint`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-proxy-secret': 'test-proxy',
    },
    body: JSON.stringify({
      userId,
      userRole: 'officer',
      organizationId: org,
      channelScope: channel,
      firstName,
      lastName: 'Tester',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Mint failed for ${firstName}: ${JSON.stringify(data)}`);
  return data.token;
}

async function main(){
  const token1 = await mint(u1, 'Alpha');
  const token2 = await mint(u2, 'Bravo');

  const ws1 = new WebSocket(`${wsBase}?token=${encodeURIComponent(token1)}`);
  const ws2 = new WebSocket(`${wsBase}?token=${encodeURIComponent(token2)}`);

  const events1 = [];
  const events2 = [];

  ws1.onmessage = (e) => { try { events1.push(JSON.parse(e.data)); } catch {} };
  ws2.onmessage = (e) => { try { events2.push(JSON.parse(e.data)); } catch {} };

  await Promise.all([
    new Promise((resolve, reject) => { ws1.onopen = resolve; ws1.onerror = reject; }),
    new Promise((resolve, reject) => { ws2.onopen = resolve; ws2.onerror = reject; }),
  ]);

  await sleep(250);

  // user1 starts speaking
  ws1.send(JSON.stringify({ type: 'start_speaking' }));
  await sleep(250);

  // while busy, user2 attempts speaking -> should get CHANNEL_BUSY
  ws2.send(JSON.stringify({ type: 'start_speaking' }));
  await sleep(250);

  // user1 stops speaking
  ws1.send(JSON.stringify({ type: 'stop_speaking', duration: 2 }));
  await sleep(250);

  const w2SawStart = events2.some(e => e.type === 'speaking' && e.event === 'start' && e.userId === u1);
  const w2SawStop = events2.some(e => e.type === 'speaking' && e.event === 'stop' && e.userId === u1);
  const w2SawBusy = events2.some(e => e.type === 'error' && e.code === 'CHANNEL_BUSY');
  const w1SawPresenceJoin = events1.some(e => e.type === 'presence' && e.event === 'join' && e.userId === u2);

  console.log(JSON.stringify({
    channel,
    checks: {
      user1_saw_user2_join: w1SawPresenceJoin,
      user2_saw_user1_start: w2SawStart,
      user2_saw_channel_busy_when_talking_over_user1: w2SawBusy,
      user2_saw_user1_stop: w2SawStop,
    },
    pass: w1SawPresenceJoin && w2SawStart && w2SawBusy && w2SawStop,
    sample_events_user2: events2.slice(0, 6),
  }, null, 2));

  ws1.close();
  ws2.close();
}

main().catch(err => {
  console.error('E2E failed:', err.message);
  process.exit(1);
});
