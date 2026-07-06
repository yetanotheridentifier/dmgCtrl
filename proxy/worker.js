export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/analytics/batch') {
      return handleAnalyticsBatch(request, env)
    }

    if (url.pathname === '/analytics') {
      return handleAnalytics(request, env)
    }

    if (url.pathname.startsWith('/swudb/deck/')) {
      const deckId = url.pathname.slice('/swudb/deck/'.length)
      const response = await fetch(`https://swudb.com/api/deck/${deckId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Referer': 'https://swudb.com/',
          'Accept': 'application/json',
        }
      })
      const data = await response.json()
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
        }
      })
    }

    // Passthrough to api.swu-db.com. Upstream errors are passed through with
    // their status and a JSON body, ALWAYS with CORS headers — an uncaught
    // throw here would become a Cloudflare 1101 page without CORS, which
    // browsers surface as an opaque "Failed to fetch".
    const target = 'https://api.swu-db.com' + url.pathname + url.search
    const passthroughHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    }
    try {
      const response = await fetch(target)
      let body
      try {
        body = JSON.stringify(await response.json())
      } catch {
        body = JSON.stringify({ error: `Upstream returned non-JSON (status ${response.status})` })
      }
      return new Response(body, { status: response.status, headers: passthroughHeaders })
    } catch (err) {
      return new Response(JSON.stringify({ error: `Upstream fetch failed: ${err.message}` }), {
        status: 502,
        headers: passthroughHeaders,
      })
    }
  }
}

const ALLOWED_ORIGINS = new Set([
  'https://dmgctrl.app',
  'https://dev.dmgctrl.app',
])

function getCorsHeaders(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function getCfGeo(request) {
  const country = request.cf?.country ?? 'unknown'
  const city = request.cf?.city ?? 'unknown'
  const lat = request.cf?.latitude != null ? parseFloat(request.cf.latitude) : null
  const lon = request.cf?.longitude != null ? parseFloat(request.cf.longitude) : null
  const geoCoords = lat !== null && lon !== null ? { latitude: lat, longitude: lon } : {}
  return { country, city, ...geoCoords }
}

function getInfluxWriteUrl(env) {
  return `${env.INFLUXDB_URL}/api/v2/write?org=${encodeURIComponent(env.INFLUXDB_ORG)}&bucket=dmgctrl&precision=s`
}

async function writeToInflux(env, body) {
  const res = await fetch(getInfluxWriteUrl(env), {
    method: 'POST',
    headers: {
      Authorization: `Token ${env.INFLUXDB_TOKEN}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body,
  })
  return res
}

async function handleAnalytics(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const corsHeaders = getCorsHeaders(origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response('Bad Request', { status: 400, headers: corsHeaders })
  }

  const geo = getCfGeo(request)
  const data = { ...body.data, ...geo }

  const influxResponse = await writeToInflux(env, toLineProtocol(body.event, data))

  if (!influxResponse.ok) {
    return new Response('Upstream Error', { status: 500, headers: corsHeaders })
  }

  return new Response(null, { status: 204, headers: corsHeaders })
}

async function handleAnalyticsBatch(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const corsHeaders = getCorsHeaders(origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response('Bad Request', { status: 400, headers: corsHeaders })
  }

  const { events } = body
  if (!Array.isArray(events) || events.length === 0) {
    return new Response(JSON.stringify({ received: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const geo = getCfGeo(request)
  const lines = events.map(event => {
    const timestampSeconds = Math.floor(new Date(event.queued_at).getTime() / 1000)
    const data = { ...event.data, queued_at: event.queued_at, ...geo }
    return toLineProtocol(event.name, data, timestampSeconds)
  })

  const influxResponse = await writeToInflux(env, lines.join('\n'))

  if (!influxResponse.ok) {
    return new Response('Upstream Error', { status: 500, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ received: events.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function toLineProtocol(event, data, timestampSeconds) {
  const entries = Object.entries(data ?? {})
  const fields = entries.length > 0
    ? entries
        .map(([key, value]) => {
          if (typeof value === 'number' && Number.isInteger(value)) return `${key}=${value}i`
          if (typeof value === 'number') return `${key}=${value}`
          if (typeof value === 'boolean') return `${key}=${value}`
          return `${key}="${String(value).replace(/"/g, '\\"')}"`
        })
        .join(',')
    : 'count=1i'
  const ts = timestampSeconds != null ? ` ${timestampSeconds}` : ''
  return `events,event=${event} ${fields}${ts}`
}
