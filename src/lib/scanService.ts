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
}

export interface ScanRecord {
  id: string
  productName: string
  brand: string
  ingredients: string[]
  extractedText: string
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
  riskClassifications: IngredientScreening[]
  safetyScore?: number
  overallRisk?: 'low' | 'medium' | 'high'
  summary?: string
}

export function calculateSafetyScore(items: IngredientScreening[]): {
  score: number
  overallRisk: 'low' | 'medium' | 'high'
  summary: string
  counts: { low: number; medium: number; high: number }
} {
  const counts = {
    low: items.filter((i) => i.level === 'low').length,
    medium: items.filter((i) => i.level === 'medium').length,
    high: items.filter((i) => i.level === 'high').length,
  }
  const total = items.length

  let score = 100
  if (total > 0) {
    const rawScore = (counts.low * 100 + counts.medium * 60 + counts.high * 20) / total
    score = Math.max(0, Math.min(100, Math.round(rawScore)))
  }

  const overallRisk: 'low' | 'medium' | 'high' =
    counts.high > 0 ? 'high' : counts.medium > 0 ? 'medium' : 'low'

  const summary = `${total} ingredients reviewed • ${counts.low} low, ${counts.medium} medium, ${counts.high} high concern`

  return { score, overallRisk, summary, counts }
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
