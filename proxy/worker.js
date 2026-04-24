export default {
  async fetch(request) {
    const url = new URL(request.url)

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