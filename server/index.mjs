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
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'
const processedImagesDir = join(dirname(fileURLToPath(import.meta.url)), 'uploads', 'processed')
let certCache = { expires: 0, keys: {} }

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

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

async function fetchGeminiWithFallback(options) {
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
      const result = await fetchGeminiWithFallback({
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
      const prompt = 'Read and transcribe the complete cosmetic ingredient list in the image or image tiles. Look closely for small printed text and labels such as Ingredients or INCI. Preserve spelling, punctuation, and order. If multiple overlapping tiles are supplied, combine them into one list in natural reading order and do not repeat text visible in more than one tile. Do not identify, correct, complete, infer, or add ingredients. If only part is readable, return the readable part without guessing. Return only the transcription.'
      async function transcribe(data, type) {
        const imageParts = Array.isArray(data)
          ? data.map((tile) => ({ inline_data: { mime_type: 'image/webp', data: tile } }))
          : [{ inline_data: { mime_type: type, data } }]
        const result = await fetchGeminiWithFallback({
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ generationConfig: { temperature: 0, maxOutputTokens: 2000 }, contents: [{ parts: [
            { text: prompt },
            ...imageParts,
          ] }] }),
        })
        const payload = await result.json()
        if (!result.ok) return { error: payload?.error?.message || 'Gemini could not process this image.', status: result.status }
        const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() ?? ''
        if (!text) console.warn('Gemini returned no transcription text', { model, finishReason: payload?.candidates?.[0]?.finishReason, blockReason: payload?.promptFeedback?.blockReason })
        return { text }
      }

      // Preserve the original detail first, then try the enhanced copy.
      let transcription = await transcribe(image, mimeType)
      if (transcription.error) return send(response, transcription.status === 429 ? 429 : 502, { error: transcription.error })
      if (!transcription.text) transcription = await transcribe(processedImage, 'image/webp')
      if (transcription.error) return send(response, transcription.status === 429 ? 429 : 502, { error: transcription.error })
      // Close-up tiles help when the ingredient panel occupies only a small area of the photo.
      if (!transcription.text) {
        const { data: orientedImage, info } = await sharp(imageBuffer).rotate().toBuffer({ resolveWithObject: true })
        const columns = info.width > 2200 ? 2 : 1
        const rows = info.height > 2200 ? 2 : 1
        const tileBuffers = []
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const cellLeft = Math.floor(column * info.width / columns)
            const cellTop = Math.floor(row * info.height / rows)
            const cellRight = Math.ceil((column + 1) * info.width / columns)
            const cellBottom = Math.ceil((row + 1) * info.height / rows)
            const left = Math.max(0, cellLeft - 100)
            const top = Math.max(0, cellTop - 100)
            const right = Math.min(info.width, cellRight + 100)
            const bottom = Math.min(info.height, cellBottom + 100)
            tileBuffers.push(await sharp(orientedImage).extract({ left, top, width: right - left, height: bottom - top }).resize({ width: 2400, height: 2400, fit: 'inside' }).normalise().sharpen().webp({ quality: 88 }).toBuffer())
          }
        }
        transcription = await transcribe(tileBuffers.map((tile) => tile.toString('base64')), 'image/webp')
        if (transcription.error) return send(response, transcription.status === 429 ? 429 : 502, { error: transcription.error })
      }
      return send(response, 200, { text: transcription.text || '' })
    } finally {
      await unlink(processedPath).catch(() => undefined)
    }
  } catch {
    return send(response, 502, { error: 'Could not prepare or read this image. Try a clearer JPG, PNG, or WEBP image.' })
  }
}

createServer((request, response) => { void extract(request, response) }).listen(port, '127.0.0.1', () => {
  console.log(`Dermobot OCR API listening on http://localhost:${port}`)
})
