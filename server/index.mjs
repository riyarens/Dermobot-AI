import { createServer } from 'node:http'
import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const port = Number(process.env.API_PORT || 8787)
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
const apiKey = process.env.GEMINI_API_KEY
const model = process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash'
const processedImagesDir = join(dirname(fileURLToPath(import.meta.url)), 'uploads', 'processed')
let certCache = { expires: 0, keys: {} }

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function verifyFirebaseToken(token) {
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
  if (!valid || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || !claims.sub || claims.exp <= now || claims.iat > now) throw new Error('Your sign-in session is invalid or expired. Please sign in again.')
  return claims
}

async function extract(request, response) {
  const route = request.url
  if (request.method !== 'POST' || !['/api/extract', '/api/analyze'].includes(route)) return send(response, 404, { error: 'Not found.' })
  if (!apiKey) return send(response, 503, { error: 'OCR is not configured. Set GEMINI_API_KEY in the server environment.' })
  const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!bearer) return send(response, 401, { error: 'Please sign in to use ingredient scanning.' })
  try { await verifyFirebaseToken(bearer) }
  catch (error) { return send(response, 401, { error: error instanceof Error ? error.message : 'Unable to verify your session.' }) }

  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > 15_000_000) return send(response, 413, { error: 'Image payload is too large. Choose an image under 10 MB.' })
  }
  let payload
  try { payload = JSON.parse(raw) } catch { return send(response, 400, { error: 'Invalid image request.' }) }
  if (route === '/api/analyze') {
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 12000) return send(response, 400, { error: 'Enter an ingredient list under 12,000 characters.' })
    const ingredients = payload.text.split(/[,;\n]+/).map((value) => value.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 100)
    if (!ingredients.length) return send(response, 400, { error: 'No ingredient names were found in the text.' })
    try {
      const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 5000,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
                index: { type: 'INTEGER' },
                level: { type: 'STRING', enum: ['low', 'medium', 'high'] },
                reason: { type: 'STRING' },
                confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
              }, required: ['index', 'level', 'reason', 'confidence'] } } },
              required: ['items'],
            },
          },
          contents: [{ parts: [{ text: `Provide a cautious, general-purpose AI screening of these cosmetic ingredient names. This is not medical advice, a regulatory determination, or an evaluation of a finished formula. A label means potential concern only; actual safety depends on concentration, formulation, exposure, product type, and individual sensitivity. Do not make up hazards, benefits, regulations, citations, or ingredient identities. If reliable general knowledge is insufficient to assess an ingredient, use level "medium", confidence "low", and say that information is insufficient. Use "high" only for a well-established significant concern at typical cosmetic use; "medium" for context-dependent or recognized irritation/sensitivity concerns; "low" only when no notable concern is generally recognized at typical cosmetic use. These categories are rough screening signals, not probability or severity scores. Return one item for each supplied ingredient, using its zero-based index. Explain briefly and cautiously. Keep the supplied order. Ingredients: ${JSON.stringify(ingredients)}` }] }],
        }),
      })
      const data = await result.json()
      if (!result.ok) {
        const message = data?.error?.message || 'Gemini could not analyze this ingredient list.'
        return send(response, result.status === 429 ? 429 : 502, { error: message })
      }
      const rawText = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
      const parsed = JSON.parse(rawText || '{}')
      const received = Array.isArray(parsed.items) ? parsed.items : []
      const byIndex = new Map(received.filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < ingredients.length).map((item) => [item.index, item]))
      const items = ingredients.map((ingredient, index) => {
        const item = byIndex.get(index)
        const level = ['low', 'medium', 'high'].includes(item?.level) ? item.level : 'medium'
        const confidence = ['low', 'medium', 'high'].includes(item?.confidence) ? item.confidence : 'low'
        return { ingredient, level, confidence, reason: typeof item?.reason === 'string' ? item.reason.slice(0, 400) : 'Insufficient information for a reliable screening.' }
      })
      return send(response, 200, { items })
    } catch {
      return send(response, 502, { error: 'Could not analyze the ingredient list. Please retry in a moment.' })
    }
  }

  const { image, mimeType } = payload
  if (typeof image !== 'string' || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || image.length > 14_000_000) return send(response, 400, { error: 'Upload a JPG, PNG, or WEBP image under 10 MB.' })

  try {
    const imageBuffer = Buffer.from(image, 'base64')
    if (!imageBuffer.length) return send(response, 400, { error: 'The selected image could not be read.' })
    const processedPath = join(processedImagesDir, `${randomUUID()}.webp`)
    await mkdir(processedImagesDir, { recursive: true })
    try {
      await sharp(imageBuffer, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 3000, height: 6000, fit: 'inside' }).normalise().sharpen().webp({ quality: 92, effort: 4 }).toFile(processedPath)
      const processedImage = (await readFile(processedPath)).toString('base64')
    const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationConfig: { temperature: 0, maxOutputTokens: 1200 }, contents: [{ parts: [
        { text: 'Transcribe the complete ingredient list visible in this image, including small print. Preserve spelling, punctuation, and order. Read all visible lines and columns in natural reading order. Do not identify, complete, correct, infer, or add any ingredient. If a portion is illegible, transcribe the readable portions and omit only the unreadable text; do not guess. If no ingredient list is legible, return an empty string. Return only the transcription, without commentary.' },
        { inline_data: { mime_type: 'image/webp', data: processedImage } },
      ] }] }),
    })
    const data = await result.json()
    if (!result.ok) {
      const message = data?.error?.message || 'The vision service could not process this image.'
      return send(response, result.status === 429 ? 429 : 502, { error: message })
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
    return send(response, 200, { text: typeof text === 'string' ? text.trim() : '' })
    } finally {
      await unlink(processedPath).catch(() => undefined)
    }
  } catch {
    return send(response, 502, { error: 'Could not prepare or read this image. Try a clearer JPG, PNG, or WEBP image.' })
  }
}

createServer((request, response) => { void extract(request, response) }).listen(port, () => {
  console.log(`Dermobot OCR API listening on http://localhost:${port}`)
})
