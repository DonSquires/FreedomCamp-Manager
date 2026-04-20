// ============================================================================
// get-weather — Real weather from Open-Meteo (no API key required)
// ============================================================================
// Previously this function asked an AI model to "guess" the weather based on
// GPS coordinates, which required an OpenAI API key and produced unreliable
// results.  It now calls Open-Meteo (https://open-meteo.com), a free,
// open-source weather API that returns real numerical forecast data.
//
// For the Field Officer scan flow, weather is now fetched directly on the
// device (src/lib/weather.ts) so this edge function is only needed for
// server-side or admin-panel callers.
// ============================================================================

import { withCors, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/withCors.ts';

// WMO Weather Interpretation Code → human-readable label
// https://open-meteo.com/en/docs#weathervariables
const WMO_CODES: Record<number, string> = {
  0:  'Clear sky',
  1:  'Mainly clear',
  2:  'Partly cloudy',
  3:  'Overcast',
  45: 'Foggy',
  48: 'Icy fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Light freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Light snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm w/ hail',
  99: 'Thunderstorm w/ heavy hail',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const { latitude, longitude } = await req.json();

    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      throw new Error('Latitude and longitude are required');
    }

    console.log('🌤️ Fetching weather for:', latitude, longitude);

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', 'temperature_2m,weathercode,windspeed_10m');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('wind_speed_unit', 'kmh');

    const weatherResponse = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });

    if (!weatherResponse.ok) {
      throw new Error(`Open-Meteo returned ${weatherResponse.status}`);
    }

    const data = await weatherResponse.json();
    const current = data?.current;

    if (!current) {
      throw new Error('Unexpected Open-Meteo response shape');
    }

    const condition = WMO_CODES[current.weathercode as number] ?? 'Unknown';
    const temp = Math.round(current.temperature_2m as number);
    const wind = Math.round(current.windspeed_10m as number);

    let weatherDescription = `${condition}, ${temp}°C`;
    if (wind > 0) weatherDescription += `, ${wind} km/h wind`;

    console.log('✅ Weather fetched:', weatherDescription);

    return new Response(
      JSON.stringify({
        success: true,
        weather: weatherDescription,
        coordinates: { latitude, longitude },
        source: 'open-meteo',
      }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ Weather fetch error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error',
        weather: 'Weather unavailable',
      }),
      {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
