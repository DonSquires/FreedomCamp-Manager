import process from 'node:process';
import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3001);
const REQUEST_TIMEOUT_MS = Number(process.env.MAPPING_GATEWAY_TIMEOUT_MS || 15000);
const TILE_STYLES = new Set(['street', 'fallback', 'satellite']);

const TILE_TEMPLATE_BY_STYLE = {
  street: String(process.env.MAPPING_GATEWAY_STREET_TILE_URL || process.env.MAPPING_GATEWAY_TILE_URL || '').trim(),
  fallback: String(process.env.MAPPING_GATEWAY_FALLBACK_TILE_URL || '').trim(),
  satellite: String(process.env.MAPPING_GATEWAY_SATELLITE_TILE_URL || '').trim(),
};

const TILE_ATTRIBUTION_BY_STYLE = {
  street: String(process.env.MAPPING_GATEWAY_STREET_TILE_ATTRIBUTION || process.env.MAPPING_GATEWAY_TILE_ATTRIBUTION || '').trim(),
  fallback: String(process.env.MAPPING_GATEWAY_FALLBACK_TILE_ATTRIBUTION || '').trim(),
  satellite: String(process.env.MAPPING_GATEWAY_SATELLITE_TILE_ATTRIBUTION || '').trim(),
};

function sanitizeWaypoints(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((wp, index) => {
      const lat = Number(wp?.lat);
      const lng = Number(wp?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return {
        id: String(wp?.id || `wp-${index + 1}`).slice(0, 80),
        label: String(wp?.label || `Waypoint ${index + 1}`).slice(0, 120),
        lat,
        lng,
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function haversineKm(a, b) {
  const deg2rad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = deg2rad(b.lat - a.lat);
  const dLng = deg2rad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return earthRadiusKm * c;
}

function orderNearestNeighbor(waypoints) {
  if (waypoints.length <= 2) return [...waypoints];
  const remaining = [...waypoints.slice(1)];
  const route = [waypoints[0]];

  while (remaining.length > 0) {
    const current = route[route.length - 1];
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const distance = haversineKm(current, remaining[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    route.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }

  return route;
}

function summarizeRoute(route) {
  if (route.length <= 1) {
    return {
      legs: [],
      estimatedDistanceKm: 0,
    };
  }

  let total = 0;
  const legs = [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const from = route[i];
    const to = route[i + 1];
    const distanceKm = haversineKm(from, to);
    total += distanceKm;
    legs.push({
      from,
      to,
      distanceKm: Number(distanceKm.toFixed(2)),
    });
  }

  return {
    legs,
    estimatedDistanceKm: Number(total.toFixed(2)),
  };
}

function applyTemplate(template, tokens) {
  let output = String(template || '').trim();
  for (const [key, value] of Object.entries(tokens)) {
    output = output.split(`{${key}}`).join(String(value));
  }
  return output;
}

function resolveTileTemplate(style) {
  return TILE_TEMPLATE_BY_STYLE[style] || '';
}

function resolveTileAttribution(style) {
  return TILE_ATTRIBUTION_BY_STYLE[style] || '';
}

function defaultContentTypeForFormat(format) {
  const normalized = String(format || '').toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  return 'image/png';
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stylePalette(style) {
  if (style === 'satellite') {
    return {
      background: '#0f172a',
      panel: '#111827',
      panelStroke: '#1f2937',
      text: '#e5e7eb',
      accent: '#38bdf8',
      accentSoft: '#1e293b',
    };
  }

  if (style === 'fallback') {
    return {
      background: '#f8fafc',
      panel: '#e2e8f0',
      panelStroke: '#cbd5e1',
      text: '#0f172a',
      accent: '#f59e0b',
      accentSoft: '#fffbeb',
    };
  }

  return {
    background: '#ecfdf5',
    panel: '#d1fae5',
    panelStroke: '#a7f3d0',
    text: '#064e3b',
    accent: '#059669',
    accentSoft: '#ecfdf5',
  };
}

function generateTileSvg({ style, z, x, y }) {
  const colors = stylePalette(style);
  const title = `${style.toUpperCase()} TILE`;
  const subtitle = `z ${z} · x ${x} · y ${y}`;
  const label = style === 'satellite' ? 'Internal satellite tile' : style === 'fallback' ? 'Internal fallback tile' : 'Internal street tile';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.background}" />
      <stop offset="100%" stop-color="${colors.accentSoft}" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#bg)" />
  <rect x="18" y="18" width="220" height="220" rx="20" fill="${colors.panel}" stroke="${colors.panelStroke}" stroke-width="4" />
  <circle cx="58" cy="58" r="10" fill="${colors.accent}" opacity="0.85" />
  <circle cx="198" cy="58" r="10" fill="${colors.accent}" opacity="0.6" />
  <circle cx="58" cy="198" r="10" fill="${colors.accent}" opacity="0.6" />
  <circle cx="198" cy="198" r="10" fill="${colors.accent}" opacity="0.85" />
  <text x="128" y="108" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="${colors.text}">${escapeXml(title)}</text>
  <text x="128" y="140" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="${colors.text}">${escapeXml(subtitle)}</text>
  <text x="128" y="170" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="${colors.text}" opacity="0.85">Generated inside mapping-gateway</text>
</svg>`;
}

async function proxyTile(req, res) {
  const style = String(req.params.style || '').toLowerCase();
  if (!TILE_STYLES.has(style)) {
    res.status(404).json({ error: 'Unknown tile style', style });
    return;
  }

  const template = resolveTileTemplate(style);
  if (!template) {
    const svg = generateTileSvg({
      style,
      z: req.params.z,
      x: req.params.x,
      y: req.params.y,
    });

    res.status(200);
    res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=3600');
    const attribution = resolveTileAttribution(style);
    if (attribution) {
      res.setHeader('x-tile-attribution', attribution);
    }
    res.send(svg);
    return;
  }

  const tileUrl = applyTemplate(template, {
    style,
    z: req.params.z,
    x: req.params.x,
    y: req.params.y,
    format: req.params.format || '',
    ext: req.params.format || '',
    s: 'a',
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(tileUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: req.headers.accept || 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'FieldOps-Mapping-Gateway/1.0',
      },
    });

    const contentType = upstream.headers.get('content-type') || defaultContentTypeForFormat(req.params.format || 'png');
    const cacheControl = upstream.headers.get('cache-control') || 'public, max-age=3600';

    res.status(upstream.status);
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', cacheControl);

    const attribution = resolveTileAttribution(style);
    if (attribution) {
      res.setHeader('x-tile-attribution', attribution);
    }

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.send(body || `Upstream tile request failed with HTTP ${upstream.status}`);
      return;
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.send(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    res.status(502).json({
      error: 'Tile proxy failed',
      style,
      message,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

app.get('/maps/tiles/:style/:z/:x/:y.:format', proxyTile);
app.get('/maps/tiles/:style/:z/:x/:y', proxyTile);

async function queryGoogleSupport(route) {
  const includeGoogle = String(process.env.GOOGLE_SUPPORT_ENABLED || '').trim().toLowerCase() === 'true';
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!includeGoogle || !apiKey || route.length < 2) {
    return { used: false, note: 'Google support disabled or unavailable.' };
  }

  const origin = `${route[0].lat},${route[0].lng}`;
  const destination = `${route[route.length - 1].lat},${route[route.length - 1].lng}`;
  const waypoints = route.slice(1, -1).map((wp) => `${wp.lat},${wp.lng}`).join('|');
  const params = new URLSearchParams({
    origin,
    destination,
    mode: 'driving',
    key: apiKey,
  });
  if (waypoints) {
    params.set('waypoints', `optimize:false|${waypoints}`);
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok || data.status !== 'OK') {
      return {
        used: false,
        note: `Google support request failed (${data.status || response.status}).`,
      };
    }

    const durationSec = (data.routes?.[0]?.legs || []).reduce((sum, leg) => sum + Number(leg?.duration?.value || 0), 0);
    const distanceMeters = (data.routes?.[0]?.legs || []).reduce((sum, leg) => sum + Number(leg?.distance?.value || 0), 0);

    return {
      used: true,
      note: 'Google support enrichment applied.',
      estimatedDriveDistanceKm: Number((distanceMeters / 1000).toFixed(2)),
      estimatedDriveDurationMin: Number((durationSec / 60).toFixed(1)),
    };
  } catch (error) {
    return {
      used: false,
      note: `Google support request failed (${error instanceof Error ? error.message : 'unknown error'}).`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

app.get('/health', (_req, res) => {
  const osrmUrl = String(process.env.OSRM_BACKEND_URL || '').trim();
  const valhallaUrl = String(process.env.VALHALLA_BACKEND_URL || '').trim();
  res.status(200).json({
    status: 'ok',
    service: 'fieldops-mapping-gateway',
    providers: {
      selfHostedRouting: true,
      osrmConfigured: Boolean(osrmUrl),
      valhallaConfigured: Boolean(valhallaUrl),
      googleSupportConfigured: Boolean(String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || '').trim()),
      streetTilesConfigured: Boolean(TILE_TEMPLATE_BY_STYLE.street),
      fallbackTilesConfigured: Boolean(TILE_TEMPLATE_BY_STYLE.fallback),
      satelliteTilesConfigured: Boolean(TILE_TEMPLATE_BY_STYLE.satellite),
    },
  });
});

app.post('/route-plan', async (req, res) => {
  const waypoints = sanitizeWaypoints(req.body?.waypoints);
  if (waypoints.length < 2) {
    res.status(400).json({
      error: 'At least two valid waypoints are required.',
    });
    return;
  }

  const ordered = orderNearestNeighbor(waypoints);
  const summary = summarizeRoute(ordered);
  const googleSupport = await queryGoogleSupport(ordered);

  res.status(200).json({
    status: 'ok',
    provider: 'self_hosted_mapping_gateway',
    orderedWaypoints: ordered,
    route: summary,
    support: {
      google: googleSupport,
    },
  });
});

app.listen(PORT, () => {
  console.log(`[mapping-gateway] listening on :${PORT}`);
});
