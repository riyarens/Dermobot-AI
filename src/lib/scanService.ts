import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore'
export interface IngredientScreening {
  ingredient: string
  level: 'low' | 'medium' | 'high'
  confidence: 'low' | 'medium' | 'high'
  reason: string
  whatItIs?: string
  commonUses?: string
}

export interface ScanRecord {
  id: string
  productName: string
  brand: string
  ingredients: string[]
  extractedText: string
  overview?: string
  ingredientListComplete?: boolean
  riskClassifications: IngredientScreening[]
  safetyScore: number
  overallRisk: 'low' | 'medium' | 'high'
  summary: string
  createdAt: number
}

export interface SaveScanInput {
  productName: string
  brand: string
  ingredients?: string[]
  extractedText: string
  overview?: string
  ingredientListComplete?: boolean
  riskClassifications: IngredientScreening[]
  safetyScore?: number
  overallRisk?: 'low' | 'medium' | 'high'
  summary?: string
}

export function calculateSafetyScore(items: IngredientScreening[], verifiedRegulatoryPenalty = 0): {
  score: number
  baseScore: number
  regulatoryPenalty: number
  overallRisk: 'low' | 'medium' | 'high'
  summary: string
  counts: { low: number; medium: number; high: number }
} {
  const severity = { low: 0, medium: 1, high: 2 } as const
  const distinctByName = new Map<string, IngredientScreening>()
  for (const item of items) {
    const key = item.ingredient.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const current = distinctByName.get(key)
    if (!current || severity[item.level] > severity[current.level]) distinctByName.set(key, item)
  }
  const uniqueItems = [...distinctByName.values()]
  const counts = {
    low: uniqueItems.filter((i) => i.level === 'low').length,
    medium: uniqueItems.filter((i) => i.level === 'medium').length,
    high: uniqueItems.filter((i) => i.level === 'high').length,
  }

  const weightSum = counts.low * 0.5 + counts.medium * 2.5 + counts.high * 5
  const baseScore = uniqueItems.length > 0
    ? Math.round(100 * (1 - weightSum / (5 * uniqueItems.length)))
    : 0
  const regulatoryPenalty = Math.max(0, verifiedRegulatoryPenalty)
  const score = Math.max(0, baseScore - regulatoryPenalty)

  const overallRisk: 'low' | 'medium' | 'high' =
    counts.high > 0 ? 'high' : counts.medium > 0 ? 'medium' : 'low'

  const total = uniqueItems.length
  const summary = `${total} distinct ingredients reviewed • ${counts.low} low, ${counts.medium} moderate, ${counts.high} high concern`

  return { score, baseScore, regulatoryPenalty, overallRisk, summary, counts }
}

export async function saveScanRecord(
  db: Firestore,
  userId: string,
  input: SaveScanInput,
): Promise<ScanRecord> {
  const { score, overallRisk, summary } = calculateSafetyScore(input.riskClassifications)
  const now = Date.now()
  const ingredients =
    input.ingredients && input.ingredients.length > 0
      ? input.ingredients
      : input.riskClassifications.map((i) => i.ingredient)

  const docPayload = {
    productName: input.productName.trim() || 'Scanned Product',
    brand: input.brand.trim() || '',
    ingredients,
    extractedText: input.extractedText,
    overview: input.overview || '',
    ingredientListComplete: input.ingredientListComplete === true,
    riskClassifications: input.riskClassifications,
    safetyScore: typeof input.safetyScore === 'number' ? input.safetyScore : score,
    overallRisk: input.overallRisk || overallRisk,
    summary: input.summary || summary,
    createdAt: serverTimestamp(),
    createdAtMillis: now,
  }

  const scansCol = collection(db, 'users', userId, 'scans')
  const docRef = await addDoc(scansCol, docPayload)

  return {
    id: docRef.id,
    ...docPayload,
    createdAt: now,
  }
}

export async function getUserScanHistory(
  db: Firestore,
  userId: string,
): Promise<ScanRecord[]> {
  const scansCol = collection(db, 'users', userId, 'scans')
  let snapshot
  try {
    const q = query(scansCol, orderBy('createdAt', 'desc'))
    snapshot = await getDocs(q)
  } catch (err) {
    console.warn('Falling back to client-side sort for scan history:', err)
    snapshot = await getDocs(scansCol)
  }

  const records: ScanRecord[] = []
  snapshot.forEach((doc) => {
    const data = doc.data()
    const rawCreatedAt = data.createdAt
    let createdAt = Date.now()
    if (rawCreatedAt && typeof rawCreatedAt.toMillis === 'function') {
      createdAt = rawCreatedAt.toMillis()
    } else if (typeof data.createdAtMillis === 'number') {
      createdAt = data.createdAtMillis
    } else if (rawCreatedAt instanceof Date) {
      createdAt = rawCreatedAt.getTime()
    } else if (typeof rawCreatedAt === 'number') {
      createdAt = rawCreatedAt
    }

    records.push({
      id: doc.id,
      productName:
        typeof data.productName === 'string' && data.productName.trim()
          ? data.productName
          : 'Scanned Product',
      brand: typeof data.brand === 'string' ? data.brand : '',
      ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
      extractedText: typeof data.extractedText === 'string' ? data.extractedText : '',
      overview: typeof data.overview === 'string' ? data.overview : '',
      ingredientListComplete: data.ingredientListComplete === true,
      riskClassifications: Array.isArray(data.riskClassifications)
        ? data.riskClassifications
        : [],
      safetyScore: typeof data.safetyScore === 'number' ? data.safetyScore : 100,
      overallRisk: ['low', 'medium', 'high'].includes(data.overallRisk)
        ? data.overallRisk
        : 'low',
      summary: typeof data.summary === 'string' ? data.summary : '',
      createdAt,
    })
  })

  return records.sort((a, b) => b.createdAt - a.createdAt)
}
