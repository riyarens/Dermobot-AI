import { fetchGeminiWithFallback, parseBody, sendJson, verifyFirebaseToken } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return sendJson(res, 503, { error: 'Analysis is not configured. Set GEMINI_API_KEY in the environment.' })
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
    return sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request payload.' })
  }

  if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 12000) {
    return sendJson(res, 400, { error: 'Enter an ingredient list under 12,000 characters.' })
  }

  const ingredients = payload.text
    .split(/[,;\n]+/)
    .map((value) => value.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 100)

  if (!ingredients.length) {
    return sendJson(res, 400, { error: 'No ingredient names were found in the text.' })
  }

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
            properties: {
              overview: { type: 'STRING' },
              items: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    index: { type: 'INTEGER' },
                    level: { type: 'STRING', enum: ['low', 'medium', 'high'] },
                    reason: { type: 'STRING' },
                    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
                    whatItIs: { type: 'STRING' },
                    commonUses: { type: 'STRING' },
                  },
                  required: ['index', 'level', 'reason', 'confidence'],
                },
              },
            },
            required: ['overview', 'items'],
          },
        },
        contents: [
          {
            parts: [
              {
                text: `Provide a cautious, general-purpose AI screening of these cosmetic ingredient names. This is not medical advice, a regulatory determination, or an evaluation of a finished formula. A label means potential concern only; actual safety depends on concentration, formulation, exposure, product type, and individual sensitivity. Do not make up hazards, benefits, regulations, citations, or ingredient identities. If reliable general knowledge is insufficient to assess an ingredient, use level "medium", confidence "low", and say that information is insufficient. Use "high" only for a well-established significant concern at typical cosmetic use; "medium" for context-dependent or recognized irritation/sensitivity concerns; "low" only when no notable concern is generally recognized at typical cosmetic use. These categories are rough screening signals, not probability or severity scores. For each ingredient, briefly explain what the substance is and its common cosmetic purpose. If identity or use is uncertain from the name, explicitly say that it cannot be reliably determined; do not guess. Also provide a short overall overview of the ingredient list: summarize the main ingredient functions and likely product type only if the names support it. If the product type is not clear from the list, say that it cannot be determined from the ingredients alone. Do not claim product efficacy or overall safety. Keep the overview to 2 sentences and use only the supplied ingredient names. Return one item for each supplied ingredient, using its zero-based index. Keep the supplied order. Ingredients: ${JSON.stringify(ingredients)}`,
              },
            ],
          },
        ],
      }),
    })

    const data = await result.json()
    if (!result.ok) {
      const message = data?.error?.message || 'Gemini could not analyze this ingredient list.'
      return sendJson(res, result.status === 429 ? 429 : 502, { error: message })
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')
    const parsed = JSON.parse(rawText || '{}')
    const received = Array.isArray(parsed.items) ? parsed.items : []
    const byIndex = new Map(
      received
        .filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < ingredients.length)
        .map((item) => [item.index, item]),
    )

    const items = ingredients.map((ingredient, index) => {
      const item = byIndex.get(index)
      const level = ['low', 'medium', 'high'].includes(item?.level) ? item.level : 'medium'
      const confidence = ['low', 'medium', 'high'].includes(item?.confidence) ? item.confidence : 'low'
      return {
        ingredient,
        level,
        confidence,
        reason: typeof item?.reason === 'string' ? item.reason.slice(0, 400) : 'Insufficient information for a reliable screening.',
        whatItIs: typeof item?.whatItIs === 'string' ? item.whatItIs.slice(0, 300) : 'Could not reliably identify this ingredient from its name alone.',
        commonUses: typeof item?.commonUses === 'string' ? item.commonUses.slice(0, 300) : 'Common cosmetic use could not be reliably determined.',
      }
    })

    const overview = typeof parsed.overview === 'string' ? parsed.overview.trim().slice(0, 500) : ''
    return sendJson(res, 200, { overview, items })
  } catch {
    return sendJson(res, 502, { error: 'Could not analyze the ingredient list. Please retry in a moment.' })
  }
}
