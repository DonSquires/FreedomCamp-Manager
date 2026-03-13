/**
 * Weather utility — fetches real current conditions from Open-Meteo.
 *
 * Open-Meteo (https://open-meteo.com) is a free, open-source weather API:
 *   • No API key required
 *   • No CORS restrictions — can be called directly from the browser/phone
 *   • Returns real numerical weather model data (not AI guesses)
 *   • Faster than routing through a server-side edge function (one less hop)
 *
 * Output format: "[Condition], [Temperature]°C[, wind speed km/h wind]"
 * e.g. "Partly cloudy, 18°C, 14 km/h wind"
 */

/**
 * WMO Weather Interpretation Codes → human-readable labels.
 * https://open-meteo.com/en/docs#weathervariables
 */
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
}

/**
 * Fetch current weather conditions directly from Open-Meteo on the device.
 * No API key, no server round-trip, no edge function needed.
 *
 * @param latitude   WGS-84 latitude (already available from device GPS)
 * @param longitude  WGS-84 longitude
 * @param timeoutMs  Abort timeout in milliseconds (default 5 000 ms)
 * @returns Human-readable weather string, or null if the coordinates or
 *          response are invalid.  Network errors and non-2xx responses are
 *          thrown so callers can catch and log them.
 */
export async function fetchWeatherOnDevice(
  latitude: number,
  longitude: number,
  timeoutMs = 5000,
): Promise<string | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('current', 'temperature_2m,weathercode,windspeed_10m')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('wind_speed_unit', 'kmh')

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Open-Meteo returned ${response.status}`)
  }

  const data = await response.json()
  const current = data?.current

  if (!current) {
    throw new Error('Unexpected Open-Meteo response shape')
  }

  const condition = WMO_CODES[current.weathercode as number] ?? 'Unknown'
  const temp = Math.round(current.temperature_2m as number)
  const wind = Math.round(current.windspeed_10m as number)

  let description = `${condition}, ${temp}°C`
  if (wind > 0) description += `, ${wind} km/h wind`

  return description
}
