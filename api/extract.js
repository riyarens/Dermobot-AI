import sharp from 'sharp'
import { fetchGeminiWithFallback, parseBody, sendJson, verifyFirebaseToken } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return sendJson(res, 503, { error: 'OCR is not configured. Set GEMINI_API_KEY in the server environment.' })
  }

  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!bearer) {
    return sendJson(res, 401, { error: 'Please sign in to use ingredient scanning.' })
  }

  try {
    await verifyFirebaseToken(bearer)
  } catch (error) {
    return sendJson(res, 401, { error: error instanceof Error ? error.message : 'Unable to verify your session.' })
  }

  let payload
  try {
    payload = await parseBody(req)
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid image request.' })
  }

  const { image, mimeType } = payload
  if (typeof image !== 'string' || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || image.length > 14_000_000) {
    return sendJson(res, 400, { error: 'Upload a JPG, PNG, or WEBP image under 10 MB.' })
  }

  try {
    const imageBuffer = Buffer.from(image, 'base64')
    if (!imageBuffer.length) {
      return sendJson(res, 400, { error: 'The selected image could not be read.' })
    }

    // Process image in-memory with sharp buffer (no disk I/O)
    const processedBuffer = await sharp(imageBuffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 3000, height: 6000, fit: 'inside' })
      .normalise()
      .sharpen()
      .webp({ quality: 92, effort: 4 })
      .toBuffer()

    const processedImage = processedBuffer.toString('base64')

    const prompt = 'Read and transcribe the cosmetic ingredient list in the image. Look closely for small printed text and labels such as Ingredients or INCI. Preserve spelling, punctuation, and order. If multiple overlapping tiles are supplied, combine them into one list in natural reading order and do not repeat text visible in more than one tile. Do not identify, correct, complete, infer, or add ingredients. If only part is readable, return the readable part without guessing. Also set complete=true only when the entire ingredient panel/list is visibly present and legible; if the image is cropped, cut off, partly unreadable, or you are uncertain, set complete=false. Return JSON with text and complete.'

    async function transcribe(data, type, canAssessFullPanel = true) {
      const imageParts = Array.isArray(data)
        ? data.map((tile) => ({ inline_data: { mime_type: 'image/webp', data: tile } }))
        : [{ inline_data: { mime_type: type, data } }]

      const result = await fetchGeminiWithFallback({
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2000,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: { text: { type: 'STRING' }, complete: { type: 'BOOLEAN' } },
              required: ['text', 'complete'],
            },
          },
          contents: [{ parts: [{ text: prompt }, ...imageParts] }],
        }),
      })

      const responsePayload = await result.json()
      if (!result.ok) {
        return { error: responsePayload?.error?.message || 'Gemini could not process this image.', status: result.status }
      }

      const rawText = responsePayload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() ?? ''
      let parsed
      try {
        parsed = JSON.parse(rawText || '{}')
      } catch {
        parsed = {}
      }
      const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
      return { text, complete: canAssessFullPanel && parsed.complete === true }
    }

    // Preserve the original detail first, then try the enhanced copy.
    let transcription = await transcribe(image, mimeType)
    if (transcription.error) {
      return sendJson(res, transcription.status === 429 ? 429 : 502, { error: transcription.error })
    }
    if (!transcription.text) {
      transcription = await transcribe(processedImage, 'image/webp')
    }
    if (transcription.error) {
      return sendJson(res, transcription.status === 429 ? 429 : 502, { error: transcription.error })
    }

    // Close-up tiles help when the ingredient panel occupies only a small area of the photo.
    if (!transcription.text) {
      const { data: orientedImage, info } = await sharp(imageBuffer).rotate().toBuffer({ resolveWithObject: true })
      const columns = info.width > 2200 ? 2 : 1
      const rows = info.height > 2200 ? 2 : 1
      const tileBuffers = []
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const cellLeft = Math.floor((column * info.width) / columns)
          const cellTop = Math.floor((row * info.height) / rows)
          const cellRight = Math.ceil(((column + 1) * info.width) / columns)
          const cellBottom = Math.ceil(((row + 1) * info.height) / rows)
          const left = Math.max(0, cellLeft - 100)
          const top = Math.max(0, cellTop - 100)
          const right = Math.min(info.width, cellRight + 100)
          const bottom = Math.min(info.height, cellBottom + 100)
          tileBuffers.push(
            await sharp(orientedImage)
              .extract({ left, top, width: right - left, height: bottom - top })
              .resize({ width: 2400, height: 2400, fit: 'inside' })
              .normalise()
              .sharpen()
              .webp({ quality: 88 })
              .toBuffer(),
          )
        }
      }
      transcription = await transcribe(tileBuffers.map((tile) => tile.toString('base64')), 'image/webp', false)
      if (transcription.error) {
        return sendJson(res, transcription.status === 429 ? 429 : 502, { error: transcription.error })
      }
    }

    return sendJson(res, 200, { text: transcription.text || '', complete: transcription.complete === true })
  } catch {
    return sendJson(res, 502, { error: 'Could not prepare or read this image. Try a clearer JPG, PNG, or WEBP image.' })
  }
}
