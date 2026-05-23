import process from 'node:process';
import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3001);
const REQUEST_TIMEOUT_MS = Number(process.env.MAPPING_GATEWAY_TIMEOUT_MS || 15000);

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
