import { createPublicKey, verify as verifySignature } from 'node:crypto'

let certCache = { expires: 0, keys: {} }

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function verifyFirebaseToken(token) {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('Server is missing FIREBASE_PROJECT_ID.')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid session token.')
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid session token.')
  if (Date.now() > certCache.expires) {
    const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com')
    if (!response.ok) throw new Error('Unable to verify sign-in session.')
    const keys = await response.json()
    const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 300)
    certCache = { keys, expires: Date.now() + maxAge * 1000 }
  }
  const cert = certCache.keys[header.kid]
  const valid = cert && verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(cert), Buffer.from(parts[2], 'base64url'))
  const now = Math.floor(Date.now() / 1000)
  if (!valid || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || !claims.sub || claims.exp <= now || claims.iat > now) {
    throw new Error('Your sign-in session is invalid or expired. Please sign in again.')
  }
  return claims
}

async function fetchGeminiWithRetry(url, options) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) return response
      const retryAfter = Number(response.headers.get('retry-after'))
      await response.body?.cancel()
      await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : 700 * (2 ** attempt) + Math.random() * 300)
    } catch (error) {
      if (attempt === 3) throw error
      await delay(700 * (2 ** attempt) + Math.random() * 300)
    }
  }
  throw new Error('Gemini is temporarily unavailable.')
}

export async function fetchGeminiWithFallback(options) {
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash'
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'
  const models = [...new Set([model, fallbackModel])]
  let response
  for (let index = 0; index < models.length; index += 1) {
    const candidateModel = models[index]
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`
    response = await fetchGeminiWithRetry(endpoint, options)
    if (response.status !== 503 || index === models.length - 1) return response
    console.warn(`Gemini model ${candidateModel} is overloaded; trying ${models[index + 1]}.`)
    await response.body?.cancel()
  }
  return response
}

export function sendJson(response, status, body) {
  if (typeof response.status === 'function' && typeof response.json === 'function') {
    return response.status(status).json(body)
  }
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

export async function parseBody(request) {
  if (request.body && typeof request.body === 'object') {
    return request.body
  }
  if (typeof request.body === 'string') {
    try {
      return JSON.parse(request.body)
    } catch {
      throw new Error('Invalid JSON payload.')
    }
  }
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > 15_000_000) throw new Error('Image payload is too large. Choose an image under 10 MB.')
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new Error('Invalid JSON payload.')
  }
}
