export default {
  async fetch(request) {
    const url = new URL(request.url)
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