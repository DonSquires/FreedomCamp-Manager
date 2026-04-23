#!/usr/bin/env node

import http from 'node:http';
import process from 'node:process';
import { resolveSpatialContext } from './spatial-intelligence-engine.mjs';
import { resolveJobContext } from './roster-context-adapter.mjs';
import { evaluateFieldRisk } from './field-evaluator.mjs';

const port = Number(process.env.PORT || 8788);

function sendJson(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8').trim();
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, service: 'spatial-context-api' });
      return;
    }

    if (req.method === 'POST' && req.url === '/spatial-context') {
      const body = await parseBody(req);
      if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
        sendJson(res, 400, { error: 'lat and lng are required numeric fields' });
        return;
      }

      const jobContext = body.jobContext ||
        (body.officerId ? await resolveJobContext({ officerId: body.officerId, atIso: body.atIso }) : null);

      const result = resolveSpatialContext({
        lat: body.lat,
        lng: body.lng,
        jobContext,
        signals: body.signals || {},
      });

      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/field-evaluation') {
      const body = await parseBody(req);
      if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
        sendJson(res, 400, { error: 'lat and lng are required numeric fields' });
        return;
      }

      const jobContext = body.jobContext ||
        (body.officerId ? await resolveJobContext({ officerId: body.officerId, atIso: body.atIso }) : null);

      const result = evaluateFieldRisk({
        ...body,
        jobContext,
      });

      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || 'Unexpected server error' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Spatial Context API listening on http://0.0.0.0:${port}`);
  console.log('Endpoints: GET /health, POST /spatial-context, POST /field-evaluation');
});
