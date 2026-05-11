export default {
  async fetch(request, env) {
    const url = new URL(request.url)

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

    const target = 'https://api.swu-db.com' + url.pathname + url.search
    const response = await fetch(target)
    const data = await response.json()
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      }
    })
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

  const country = request.cf?.country ?? 'unknown'
  const city = request.cf?.city ?? 'unknown'
  const data = { ...body.data, country, city }

  const writeUrl =
    `${env.INFLUXDB_URL}/api/v2/write` +
    `?org=${encodeURIComponent(env.INFLUXDB_ORG)}&bucket=dmgctrl&precision=s`

  const influxResponse = await fetch(writeUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${env.INFLUXDB_TOKEN}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: toLineProtocol(body.event, data),
  })

  if (!influxResponse.ok) {
    return new Response('Upstream Error', { status: 500, headers: corsHeaders })
  }

  return new Response(null, { status: 204, headers: corsHeaders })
}

function toLineProtocol(event, data) {
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

  return `events,event=${event} ${fields}`
}
