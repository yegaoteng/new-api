const B2_ACCOUNT_ID = 'd276434d8c0c'
const B2_APP_KEY_ID = '004d276434d8c0c0000000001'
const B2_APP_KEY = 'K004o2BFIEsFi2nIm3iN6NhFW6yf6bg'
const BUCKET_NAME = 'pastegugugaga'

let authToken, apiUrl, downloadUrl

async function b2Auth() {
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': 'Basic ' + btoa(B2_APP_KEY_ID + ':' + B2_APP_KEY)
    }
  })
  const j = await res.json()
  authToken = j.authorizationToken
  apiUrl = j.apiUrl
  downloadUrl = j.downloadUrl
}

export default {
  async fetch(request) {
    if (!authToken) await b2Auth()
    const key = request.url.replace(/.*?\/\/[^\/]+/, '').replace(/^\/+/, '')
    if (!key) return new Response('Not Found', { status: 404 })

    const dlUrl = `${downloadUrl}/file/${BUCKET_NAME}/${key}`
    const resp = await fetch(dlUrl, {
      cf: { cacheEverything: true, cacheTtl: 2592000 }
    })
    return new Response(resp.body, resp)
  }
}
