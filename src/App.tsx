import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import { ArrowRight, Check, Eye, EyeOff, FlaskConical, ImagePlus, Leaf, LockKeyhole, LogOut, Mail, ShieldCheck, Sparkles, Upload, X, RotateCcw } from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { auth, db, firebaseConfigured } from './firebase'
import { regulatoryIngredients, toxicityCategories } from './data/regulatoryIngredients'
import { applyRiskCategories } from './lib/riskClassification'
import {
  type IngredientScreening,
  type ScanRecord,
  calculateSafetyScore,
  getUserScanHistory,
  saveScanRecord,
} from './lib/scanService'

type Mode = 'login' | 'signup'

function reclassifySavedScan(scan: ScanRecord): ScanRecord {
  const riskClassifications = applyRiskCategories(scan.riskClassifications)
  const { score, overallRisk, summary } = calculateSafetyScore(riskClassifications)
  return { ...scan, riskClassifications, safetyScore: score, overallRisk, summary }
}

function fallbackProductOverview(items: IngredientScreening[]) {
  const { counts, summary } = calculateSafetyScore(items)
  const concernSummary = counts.high > 0 || counts.medium > 0
    ? `The screening matched ${counts.high} high-risk and ${counts.medium} medium-risk ingredient${counts.high + counts.medium === 1 ? '' : 's'}.`
    : 'The screening found no matches in the listed high- and medium-risk watchlists.'
  return `${summary}. ${concernSummary} Product type cannot be determined reliably from ingredient names alone.`
}

function getEvidenceConfidence(items: IngredientScreening[]) {
  if (!items.length) return 'Insufficient' as const
  if (items.some((item) => item.confidence === 'low')) return 'Low' as const
  if (items.some((item) => item.confidence === 'medium')) return 'Moderate' as const
  return 'High' as const
}

function hasRegulatoryMatch(items: IngredientScreening[], region: 'FDA' | 'EU') {
  return items.some((item) => item.reason.includes(`${region} banned:`) || item.reason.includes(`${region} restricted:`))
}

function getHazardFlagSummary(items: IngredientScreening[]) {
  const categories = [
    { match: 'Carcinogens:', label: 'Carcinogenicity' },
    { match: 'Allergens:', label: 'Allergen/sensitization' },
    { match: 'Endocrine disruptors:', label: 'Endocrine-related' },
    { match: 'FDA banned:', label: 'FDA list match' },
    { match: 'FDA restricted:', label: 'FDA list match' },
    { match: 'EU banned:', label: 'EU list match' },
    { match: 'EU restricted:', label: 'EU list match' },
  ]
  return [...new Set(categories.filter(({ match }) => items.some((item) => item.reason.includes(match))).map(({ label }) => label))]
}

function scoreCategory(score: number) {
  if (score >= 80) return 'Lower screening concern (provisional)'
  if (score >= 60) return 'Moderate screening concern (provisional)'
  if (score >= 40) return 'Elevated screening concern (provisional)'
  return 'High screening concern (provisional)'
}


async function readApiResponse<T extends { error?: string }>(response: Response): Promise<T> {
  const body = await response.text()
  let payload: T
  try { payload = JSON.parse(body) as T }
  catch {
    throw new Error(response.ok
      ? 'The scanner API returned an unreadable response. Check the API terminal and try again.'
      : `The scanner API returned an unexpected response (${response.status}). Make sure npm run dev:api is running.`)
  }
  if (!response.ok) throw new Error(payload.error || `Scanner request failed (${response.status}).`)
  return payload
}

function RegulatoryIngredientList({ title, items }: { title: string; items: { name: string; conditions: string }[] }) {
  return <div className="regulatory-list">
    <h3>{title} <span>{items.length}</span></h3>
    {items.length ? <ul>{items.map((item) => <li key={item.name}>
      <strong>{item.name}</strong>{'foundIn' in item && item.foundIn && <span>Found in: {item.foundIn}</span>}{item.conditions && <span>{item.conditions}</span>}
    </li>)}</ul> : <p>No items listed.</p>}
  </div>
}

function ToxicityDropdown({ title, items }: { title: keyof typeof toxicityCategories; items: (typeof toxicityCategories)[keyof typeof toxicityCategories] }) {
  return <details className="regulatory-chip-dropdown toxicity-dropdown">
    <summary className="regulatory-chip-summary">{title}</summary>
    <div className="regulatory-overview-content">
      <p className="regulatory-overview-note">Informational screening categories. Risk depends on ingredient form, amount, exposure, and product use.</p>
      <RegulatoryIngredientList title={title} items={items} />
    </div>
  </details>
}

function RegulatoryDropdown({ region, items }: { region: 'FDA' | 'EU'; items: typeof regulatoryIngredients.FDA }) {
  const label = region === 'EU' ? 'EU' : 'FDA'
  return <details className="regulatory-chip-dropdown">
    <summary className="regulatory-chip-summary">{label}</summary>
    <div className="regulatory-overview-content">
      <p className="regulatory-overview-note">Rules can depend on product type, concentration, and how an ingredient is used.</p>
      <div className="regulatory-categories">
        <RegulatoryIngredientList title="Banned" items={items.banned} />
        <RegulatoryIngredientList title="Restricted" items={items.restricted} />
      </div>
    </div>
  </details>
}

function Brand() {
  return <a className="brand" href="/" aria-label="Dermobot home">
    <span className="brand-mark"><Sparkles size={18} strokeWidth={2.3} /></span>
    <span>dermobot<span className="brand-period">.</span></span>
  </a>
}

function LoadingScreen() {
  return <main className="auth-loading" role="status"><span className="spinner" />Checking your session...</main>
}

function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading || (!user && auth?.currentUser)) return <LoadingScreen />
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function AuthPage({ mode }: { mode: Mode }) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const isSignup = mode === 'signup'

  if (loading) return <LoadingScreen />
  if (user) return <Navigate to="/dashboard" replace />

  function firebaseMessage(code: string) {
    switch (code) {
      case 'auth/email-already-in-use': return 'An account already exists for this email. Try logging in instead.'
      case 'auth/invalid-email': return 'Enter a valid email address.'
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password': return 'Email or password is incorrect. Check your details and try again.'
      case 'auth/weak-password': return 'Choose a stronger password with at least 8 characters.'
      case 'auth/too-many-requests': return 'Too many attempts. Wait a little before trying again.'
      case 'auth/network-request-failed': return 'A network error interrupted the request. Check your connection and retry.'
      case 'auth/operation-not-allowed': return 'Email and password sign-in is disabled for this Firebase project.'
      case 'auth/user-disabled': return 'This account has been disabled. Contact support for help.'
      default: return 'We could not complete that request. Please try again.'
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const firebaseAuth = auth
    if (!firebaseAuth) {
      setError('Firebase is not configured. Add your Firebase web app values to .env.local, then restart Vite.')
      return
    }
    setError('')
    setInfo('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    if (isSignup && password.length < 8) {
      setError('Your password must be at least 8 characters long.')
      setBusy(false)
      return
    }
    try {
      if (isSignup) {
        const name = String(form.get('name') ?? '').trim()
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password)
        if (name) await updateProfile(credential.user, { displayName: name }).catch(() => undefined)
        navigate('/dashboard', { replace: true, state: { signupSuccess: true } })
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email, password)
        navigate('/dashboard', { replace: true })
      }
    } catch (caught) {
      const code = typeof caught === 'object' && caught !== null && 'code' in caught ? String(caught.code) : ''
      setError(firebaseMessage(code))
    } finally {
      setBusy(false)
    }
  }

  async function handleResetPassword() {
    const firebaseAuth = auth
    if (!firebaseAuth) {
      setError('Firebase is not configured. Add your Firebase web app values to .env.local first.')
      return
    }
    const email = (document.querySelector<HTMLInputElement>('input[name="email"]')?.value ?? '').trim()
    if (!email) {
      setError('Enter your email address first, then choose “Forgot password?”.')
      return
    }
    setError('')
    setInfo('')
    setBusy(true)
    try {
      await sendPasswordResetEmail(firebaseAuth, email)
      setInfo('Password reset email sent. Check your inbox.')
    } catch (caught) {
      const code = typeof caught === 'object' && caught !== null && 'code' in caught ? String(caught.code) : ''
      setError(code === 'auth/operation-not-allowed'
        ? 'Google sign-in is not enabled for this Firebase project. Enable Google under Firebase Authentication providers.'
        : code === 'auth/unauthorized-domain'
          ? 'This domain is not authorized for Firebase sign-in. Add it under Firebase Authentication authorized domains.'
          : firebaseMessage(code))
    } finally {
      setBusy(false)
    }
  }

  function changeMode(next: Mode) {
    setError('')
    setInfo('')
    navigate(next === 'signup' ? '/signup' : '/login')
  }

  return <main className="page-shell auth-page" id="home">
    <header className="auth-header"><Brand /><span className="auth-header-caption">COSMETIC INGREDIENT SAFETY</span></header>
    <section className="form-panel">
      <div className="form-wrap">
        <div className="form-intro"><span className="welcome-tag"><Sparkles size={13} /> DERMOBOT ACCOUNT</span><h2>Your skin deserves<br /><span>to know.</span></h2><p>{isSignup ? 'Create an account to start checking cosmetic ingredients.' : 'Sign in to scan and understand your cosmetic ingredients.'}</p></div>
        <div className="mode-switch" role="tablist" aria-label="Choose account action">
          <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? 'active' : ''} onClick={() => changeMode('login')}>Log in</button>
          <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? 'active' : ''} onClick={() => changeMode('signup')}>Create account</button>
        </div>
        {!firebaseConfigured && <p className="auth-message error" role="alert">Firebase is not configured yet. Add your project values to <code>.env.local</code> to enable account access.</p>}
        <form className="auth-form" onSubmit={handleSubmit}>
          {isSignup && <label className="field"><span>Your name</span><div className="input-shell"><span className="field-icon"><Leaf size={17} /></span><input autoComplete="name" name="name" placeholder="e.g. Alex Morgan" required disabled={busy} /></div></label>}
          <label className="field"><span>Email address</span><div className="input-shell"><span className="field-icon"><Mail size={17} /></span><input autoComplete="email" name="email" type="email" placeholder="you@example.com" required disabled={busy} /></div></label>
          <label className="field"><span>Password</span><div className="input-shell"><span className="field-icon"><LockKeyhole size={17} /></span><input autoComplete={isSignup ? 'new-password' : 'current-password'} name="password" type={showPassword ? 'text' : 'password'} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} minLength={isSignup ? 8 : undefined} required disabled={busy} /><button className="visibility-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)} disabled={busy}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          {!isSignup && <div className="forgot-row"><label className="remember"><input type="checkbox" /> <span>Remember me</span></label><button className="text-link" type="button" onClick={() => void handleResetPassword()} disabled={busy}>Forgot password?</button></div>}
          {isSignup && <label className="terms-check"><input type="checkbox" required disabled={busy} /><span>I agree to the <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</span></label>}
          <button className="submit-button" type="submit" disabled={busy}><span>{busy ? <><span className="button-spinner" /> {isSignup ? 'Creating account...' : 'Signing in...'}</> : isSignup ? 'Create account' : 'Sign in to Dermobot'}</span>{!busy && <ArrowRight size={18} />}</button>
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {info && <p className="auth-message success" role="status"><Check size={16} />{info}</p>}
        </form>
        <p className="switch-prompt">{isSignup ? 'Already have an account?' : 'New to Dermobot?'} <button type="button" onClick={() => changeMode(isSignup ? 'login' : 'signup')}>{isSignup ? 'Log in' : 'Create an account'}</button></p>
      </div>
    </section>
  </main>
}

function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const dashboardPage = location.pathname.endsWith('/history') ? 'history' : location.pathname.endsWith('/report') ? 'report' : 'scan'
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState('')
  const [extractedText, setExtractedText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [analysis, setAnalysis] = useState<IngredientScreening[] | null>(null)
  const [productOverview, setProductOverview] = useState('')
  const [ingredientListComplete, setIngredientListComplete] = useState<boolean | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [savingScan, setSavingScan] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [viewingSavedScan, setViewingSavedScan] = useState<ScanRecord | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const savedScanSignature = useRef<string>('')
  const signupSuccess = (location.state as { signupSuccess?: boolean } | null)?.signupSuccess

  function loadHistory() {
    if (!user || !db) {
      setHistoryLoading(false)
      return
    }
    setHistoryLoading(true)
    setHistoryError('')
    getUserScanHistory(db, user.uid)
      .then((records) => {
        setScans(records.map(reclassifySavedScan))
      })
      .catch((err) => {
        console.error('Error fetching scan history:', err)
        setHistoryError('Could not load scan history. Make sure Cloud Firestore is enabled in your Firebase Console.')
      })
      .finally(() => {
        setHistoryLoading(false)
      })
  }

  useEffect(() => {
    if (dashboardPage === 'history') loadHistory()
  }, [user, dashboardPage])

  function chooseImage(file?: File) {
    setOcrError('')
    setViewingSavedScan(null)
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setOcrError('Choose a JPG, PNG, or WEBP image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setOcrError('That image is larger than 10 MB. Choose a smaller file.')
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setSelectedImage(file)
    setPreview(URL.createObjectURL(file))
    setExtractedText('')
    setAnalysis(null)
    setProductOverview('')
    setIngredientListComplete(null)
    setAnalysisError('')
  }

  async function extractIngredients() {
    if (!selectedImage || ocrLoading) return
    setOcrLoading(true)
    setOcrError('')
    setExtractedText('')
    setAnalysis(null)
    setProductOverview('')
    setIngredientListComplete(null)
    setViewingSavedScan(null)
    try {
      if (!auth?.currentUser) throw new Error('Your session has expired. Please sign in again.')
      const token = await auth.currentUser.getIdToken()
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] ?? '') : reject(new Error('Could not read image'))
        reader.onerror = () => reject(new Error('Could not read image'))
        reader.readAsDataURL(selectedImage)
      })
      const response = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image: imageData, mimeType: selectedImage.type }) })
      const payload = await readApiResponse<{ text?: string; complete?: boolean; error?: string }>(response)
      const text = (payload.text ?? '').trim()
      setIngredientListComplete(payload.complete === true)
      if (!text) setOcrError('Gemini returned no ingredient text from the original or enhanced image. Try a close crop of the ingredient panel, or a higher-resolution photo.')
      else {
        setExtractedText(text)
        await analyzeIngredients(text, payload.complete === true)
      }
    } catch (caught) {
      setOcrError(caught instanceof Error ? caught.message : 'We could not read this image. Please try again or upload a clearer photo.')
    } finally {
      setOcrLoading(false)
    }
  }

  async function analyzeIngredients(ingredientText = extractedText, listComplete = ingredientListComplete === true) {
    if (!ingredientText.trim() || analysisLoading) return
    setAnalysisLoading(true)
    setAnalysisError('')
    setAnalysis(null)
    setProductOverview('')
    try {
      if (!auth?.currentUser) throw new Error('Your session has expired. Please sign in again.')
      const token = await auth.currentUser.getIdToken()
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: ingredientText }) })
      const payload = await readApiResponse<{ overview?: string; items?: IngredientScreening[]; error?: string }>(response)
      const items = applyRiskCategories(payload.items ?? [])
      setAnalysis(items)
      setProductOverview(payload.overview?.trim() || fallbackProductOverview(items))
      setIngredientListComplete(listComplete)
      navigate('/dashboard/report')

      // Save scan results to Firestore if not already saved (prevents duplicate saves)
      if (auth.currentUser && db && items.length > 0) {
        const fallbackName = selectedImage?.name
          ? selectedImage.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
          : 'Product Scan'
        const currentSignature = `${auth.currentUser.uid}_${ingredientText.trim()}_${fallbackName}`
        if (savedScanSignature.current !== currentSignature) {
          try {
            setSavingScan(true)
            const savedRecord = await saveScanRecord(db, auth.currentUser.uid, {
              productName: fallbackName,
              brand: '',
              extractedText: ingredientText,
              overview: payload.overview?.trim() || fallbackProductOverview(items),
              ingredientListComplete: listComplete,
              riskClassifications: items,
            })
            savedScanSignature.current = currentSignature
            setScans((prev) => [savedRecord, ...prev.filter((s) => s.id !== savedRecord.id)])
            setSaveMessage('Saved to your scan history')
            window.setTimeout(() => setSaveMessage(''), 3000)
          } catch (saveErr) {
            console.error('Failed to save scan to Firestore:', saveErr)
            setSaveMessage('Could not save to history. Verify Firestore is enabled in your project.')
          } finally {
            setSavingScan(false)
          }
        }
      }
    } catch (caught) {
      setAnalysisError(caught instanceof Error ? caught.message : 'Could not analyze these ingredients. Please retry.')
    } finally {
      setAnalysisLoading(false)
    }
  }

  function resetScan() {
    if (preview) URL.revokeObjectURL(preview)
    setSelectedImage(null)
    setPreview('')
    setExtractedText('')
    setOcrError('')
    setAnalysis(null)
    setProductOverview('')
    setIngredientListComplete(null)
    setAnalysisError('')
    setViewingSavedScan(null)
    setSaveMessage('')
    savedScanSignature.current = ''
    if (fileInput.current) fileInput.current.value = ''
    navigate('/dashboard')
  }

  function openSavedScan(scan: ScanRecord) {
    const currentScan = reclassifySavedScan(scan)
    setViewingSavedScan(currentScan)
    setExtractedText(currentScan.extractedText || currentScan.ingredients.join(', '))
    setAnalysis(currentScan.riskClassifications)
    setProductOverview(currentScan.overview || fallbackProductOverview(currentScan.riskClassifications))
    setIngredientListComplete(currentScan.ingredientListComplete === true)
    setOcrError('')
    setAnalysisError('')
    savedScanSignature.current = `${user?.uid}_${(scan.extractedText || '').trim()}_${scan.productName.trim()}`
    navigate('/dashboard/report')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function closeSavedScan() {
    setViewingSavedScan(null)
    resetScan()
  }

  function formatScanDate(millis: number) {
    if (!millis) return ''
    return new Date(millis).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  async function handleLogout() {
    if (!auth) return
    setLoggingOut(true)
    setLogoutError('')
    try {
      await signOut(auth)
      navigate('/login', { replace: true })
    } catch {
      setLogoutError('Unable to sign out right now. Please retry.')
      setLoggingOut(false)
    }
  }

  return <main className="dashboard-shell">
    <header className="dashboard-header"><Brand /><nav className="dashboard-nav" aria-label="Dashboard pages"><Link to="/dashboard" onClick={() => { if (dashboardPage !== 'scan') resetScan() }} aria-current={dashboardPage === 'scan' ? 'page' : undefined}>Scan</Link><Link to="/dashboard/report" aria-current={dashboardPage === 'report' ? 'page' : undefined}>Report</Link><Link to="/dashboard/history" aria-current={dashboardPage === 'history' ? 'page' : undefined}>History</Link></nav><div className="dashboard-user"><span className="user-avatar">{(user?.displayName || user?.email || 'D').charAt(0).toUpperCase()}</span><span className="user-email">{user?.displayName || user?.email}</span><button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="logout-button"><LogOut size={16} />{loggingOut ? 'Signing out...' : 'Log out'}</button></div></header>
    <section className="dashboard-content scanner-content">
      <div className="dashboard-welcome"><span className="welcome-tag"><Sparkles size={13} /> YOUR SKINCARE, MADE CLEAR</span><h1>{dashboardPage === 'history' ? 'Your Scan History' : dashboardPage === 'report' ? 'Ingredient Risk Report' : <>Know What Goes Into<br className="desktop-break" /> Your Skincare.</>}</h1><p>{dashboardPage === 'history' ? 'Open a saved scan to review its categorized ingredient report.' : dashboardPage === 'report' ? 'Review ingredients grouped into high, medium, and low risk categories.' : 'Upload a product ingredient list to extract and categorize its ingredients.'}</p></div>
      {dashboardPage === 'report' && <section className="report-product-heading" aria-label="Product name">
        <span className="report-product-mark"><FlaskConical size={17} /></span>
        <div><span className="results-kicker">PRODUCT NAME</span><h2>{viewingSavedScan?.productName || selectedImage?.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') || (analysis ? 'Scanned product' : 'Waiting for scan')}</h2></div>
        <span className="report-product-date">{viewingSavedScan ? formatScanDate(viewingSavedScan.createdAt) : analysis ? 'Current scan' : 'Scan a product to generate a report'}</span>
      </section>}
      {dashboardPage === 'history' && <Link className="browse-button history-new-scan" to="/dashboard" onClick={resetScan}><ImagePlus size={14} /> New scan</Link>}
      {dashboardPage === 'report' && <Link className="browse-button history-new-scan" to="/dashboard/history">Open scan history</Link>}
      {signupSuccess && <p className="auth-message success" role="status"><Check size={16} /> Your Dermobot account was created successfully.</p>}
      {logoutError && <p className="auth-message error" role="alert">{logoutError}</p>}
      {dashboardPage === 'scan' && <section className="scanner-card" aria-labelledby="scan-title">
        <div className="scanner-card-heading"><span className="upload-icon"><ImagePlus size={20} /></span><div><h2 id="scan-title">Scan Your Ingredient List</h2><p>Upload a clear photo of the ingredients printed on your product packaging.</p></div></div>
        <div className={`drop-zone ${dragging ? 'drop-zone-active' : ''} ${preview ? 'has-preview' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseImage(event.dataTransfer.files[0]) }}>
          <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => chooseImage(event.target.files?.[0])} />
          {preview ? <><img src={preview} alt="Selected ingredient list preview" className="image-preview" /><button type="button" className="remove-image" aria-label="Remove selected image" onClick={resetScan}><X size={16} /></button><div className="preview-name">{selectedImage?.name}</div></> : <><span className="drop-icon"><Upload size={21} /></span><strong>Drop your image here</strong><span className="drop-support">or browse a file from your device</span><button className="browse-button" type="button" onClick={() => fileInput.current?.click()}>Choose image</button></>}
        </div>
        <div className="upload-meta"><span>JPG, PNG, WEBP</span><span>Maximum file size: 10 MB</span></div>
        {ocrError && <p className="auth-message error scanner-message" role="alert">{ocrError}</p>}
        <button type="button" className="extract-button" disabled={!selectedImage || ocrLoading || analysisLoading} onClick={() => void extractIngredients()}>{analysisLoading ? <><span className="button-spinner" /> Generating your report...</> : ocrLoading ? <><span className="button-spinner" /> Reading your ingredient list...</> : <><Sparkles size={16} /> Scan ingredient list <ArrowRight size={16} /></>}</button>
        {analysisError && <p className="auth-message error scanner-message" role="alert">{analysisError}</p>}
        {analysisError && extractedText && <button type="button" className="reset-button scanner-retry" onClick={() => void analyzeIngredients(extractedText)} disabled={analysisLoading}>Retry analysis</button>}
      </section>}
      {dashboardPage === 'report' && <>
      <section className="cosmetic-safety-section" aria-labelledby="cosmetic-safety-title">
        {viewingSavedScan && <div className="report-product-label"><strong>{viewingSavedScan.productName}</strong>{viewingSavedScan.brand && <span>{viewingSavedScan.brand}</span>}<span>{formatScanDate(viewingSavedScan.createdAt)}</span></div>}
        {(savingScan || saveMessage) && <p className="report-save-status" role="status">{savingScan ? 'Saving report to history…' : saveMessage}</p>}
        <div className="cosmetic-safety-heading"><span className="results-kicker">REFERENCE LISTS</span><h2 id="cosmetic-safety-title">Cosmetic Safety Regulations</h2></div>
        {(() => {
          const scoreData = analysis ? calculateSafetyScore(analysis) : null
          const confidence = analysis ? getEvidenceConfidence(analysis) : 'Insufficient'
          const fdaMatch = analysis ? hasRegulatoryMatch(analysis, 'FDA') : false
          const euMatch = analysis ? hasRegulatoryMatch(analysis, 'EU') : false
          const verificationRequired = !analysis || !ingredientListComplete || confidence === 'Low' || confidence === 'Insufficient' || fdaMatch || euMatch
          const category = !scoreData ? 'Insufficient Data' : verificationRequired ? 'Further Verification Required' : scoreCategory(scoreData.score)
          const hazardFlags = analysis ? getHazardFlagSummary(analysis) : []
          return <>
            <div className="product-overview-score">
              <div className="product-overview-copy">
                <span className="results-kicker">OVERALL PRODUCT OVERVIEW</span>
                <p>{analysis ? productOverview || fallbackProductOverview(analysis) : 'Scan a product to see an overview of its ingredient list and screening results.'}</p>
              </div>
              <div className="product-score-panel">
                <span className="results-kicker">INGREDIENT SCREENING SCORE</span>
                <strong>{scoreData?.score ?? '—'}<small>/100</small></strong>
                <span className="score-category-label">{category}</span>
              </div>
              <div className="product-screening-meta">
                <div><strong>FDA status</strong><span className={fdaMatch ? 'status-potential' : 'status-unverified'}>{!analysis ? 'Insufficient Data' : fdaMatch ? 'Concern — potential match; violation unverified' : 'Unverified — no match in current list'}</span></div>
                <div><strong>EU status</strong><span className={euMatch ? 'status-potential' : 'status-unverified'}>{!analysis ? 'Insufficient Data' : euMatch ? 'Concern — potential match; violation unverified' : 'Unverified — no match in current list'}</span></div>
                <div><strong>Hazard flags</strong><span>{!analysis ? 'Insufficient Data' : hazardFlags.length ? hazardFlags.join(', ') : 'No high or moderate watchlist matches'}</span></div>
                <div><strong>Evidence confidence</strong><span>{confidence}</span></div>
                <div><strong>Ingredient-list completeness estimate</strong><span>{analysis ? ingredientListComplete ? 'Image appears complete; verify against package' : 'Unconfirmed — verify full panel' : 'Insufficient Data'}</span></div>
              </div>
            </div>
            {scoreData && <details className="score-method">
              <summary>How the screening score is calculated</summary>
              <p>Base score B = round[100 × (1 − (0.5L + 2.5M + 5H) ÷ (5N))], where L, M, and H are the counts of distinct low-, moderate-, and high-concern ingredients, and N = L + M + H. Final score S = max(0, B − P). P includes only verified, applicable regulatory violations.</p>
              <p>Score bands: 80–100 lower, 60–79 moderate, 40–59 elevated, and 0–39 high screening concern. The band is provisional and replaced by “Further Verification Required” when the ingredient panel is not confirmed complete, evidence confidence is low/insufficient, or an FDA/EU list match needs review.</p>
              <p>Dermobot does not independently verify official regulatory status or concentration/use-condition violations, so this scan applies no regulatory penalty (P = 0); potential matches are marked for verification. The weights and category bands are design choices, not official or scientifically validated safety values.</p>
              <p>A score cannot establish product safety. Concentration and exposure data are unavailable from an ingredient photo alone.</p>
            </details>}
          </>
        })()}
        <div className="watchlist-group">
          <h3>Compliance</h3>
          <div className="regulatory-chip-row">
            <RegulatoryDropdown region="FDA" items={regulatoryIngredients.FDA} />
            <RegulatoryDropdown region="EU" items={regulatoryIngredients.EU} />
          </div>
        </div>
        <div className="watchlist-group">
          <h3>Toxicity Watchlists</h3>
          <div className="regulatory-chip-row">
            <ToxicityDropdown title="Carcinogens" items={toxicityCategories.Carcinogens} />
            <ToxicityDropdown title="Allergens" items={toxicityCategories.Allergens} />
            <ToxicityDropdown title="Endocrine disruptors" items={toxicityCategories['Endocrine disruptors']} />
          </div>
        </div>
      </section>
      {analysis ? <section className="report-findings" aria-labelledby="report-findings-title">
        <div className="report-findings-heading">
          <div><span className="results-kicker">SCAN RESULTS</span><h2 id="report-findings-title">Ingredient screening</h2></div>
          <span>{analysis.length} {analysis.length === 1 ? 'ingredient' : 'ingredients'} reviewed</span>
        </div>
        <p className="analysis-disclaimer">Risk groups reflect matches in Dermobot’s screening lists. They are informational and do not establish product safety; actual risk depends on ingredient identity, concentration, exposure, and individual sensitivity.</p>
        {analysis.length ? <div className="ingredient-risk-groups">
          {(['high', 'medium', 'low'] as const).map((level) => {
            const items = analysis.filter((item) => item.level === level)
            if (!items.length) return null
            const title = `${level[0].toUpperCase()}${level.slice(1)} risk`
            return <details className={`ingredient-risk-group risk-group-${level}`} key={level}>
              <summary><span>{title}</span><span className={`screening-badge screening-${level}`}>{items.length} {items.length === 1 ? 'ingredient' : 'ingredients'}</span></summary>
              <div className="ingredient-screenings">
                {items.map((item, index) => <article className="ingredient-screening" key={`${index}-${item.ingredient}`}>
                  <div className="ingredient-screening-title"><span className="ingredient-name-link"><strong>{item.ingredient}</strong><a className="ingredient-wikipedia-link" href={`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(item.ingredient)}`} target="_blank" rel="noopener noreferrer" aria-label={`Search Wikipedia for ${item.ingredient}`}>Wikipedia ↗</a></span></div>
                  <p>{item.reason}</p>
                  <p className="ingredient-details"><strong>What it is:</strong> {item.whatItIs || 'Could not reliably identify this ingredient from its name alone.'}<br /><strong>Common cosmetic use:</strong> {item.commonUses || 'Common cosmetic use could not be reliably determined.'}</p>
                </article>)}
              </div>
            </details>
          })}
        </div> : <p className="report-no-findings">No ingredient findings were returned for this scan.</p>}
      </section> : <section className="report-findings report-empty" aria-live="polite">
        <h2>{analysisLoading ? 'Preparing your report…' : 'No report is open'}</h2>
        <p>{analysisLoading ? 'Your scan is being analyzed. Its findings will appear here before the scan is saved to history.' : 'Upload an ingredient-list image from the Scan page, or open a saved scan from History.'}</p>
        {analysisError && <p className="auth-message error" role="alert">{analysisError}</p>}
        {!analysisLoading && <Link className="browse-button" to={scans.length ? '/dashboard/history' : '/dashboard'}>{scans.length ? 'Open scan history' : 'Start a scan'}</Link>}
      </section>}
      </>}

      {dashboardPage === 'history' && <section className="history-section" aria-labelledby="history-title">
        <div className="history-heading">
          <div>
            <h2 id="history-title">Scan History</h2>
            <p>Your previously analyzed skincare products and safety evaluations.</p>
          </div>
          <span className="history-count">
            {scans.length} {scans.length === 1 ? 'scan' : 'scans'}
          </span>
        </div>

        {historyLoading && (
          <div className="history-empty" role="status">
            <span className="spinner" />
            <strong>Loading your scan history...</strong>
            <span>Retrieving saved reports from Firestore</span>
          </div>
        )}

        {historyError && (
          <div className="auth-message error" style={{ marginTop: '16px' }} role="alert">
            <span>{historyError}</span>
            <button
              type="button"
              className="browse-button"
              style={{ marginLeft: 'auto', padding: '5px 10px' }}
              onClick={loadHistory}
            >
              Retry
            </button>
          </div>
        )}

        {!historyLoading && !historyError && scans.length === 0 && (
          <div className="history-empty">
            <span className="empty-icon"><FlaskConical size={20} /></span>
            <strong>No previous scans found</strong>
            <span>Start a scan to create a report. Saved scans will appear here.</span>
          </div>
        )}

        {!historyLoading && !historyError && scans.length > 0 && (
          <div className="scan-list" role="list" aria-label="Previous product scans">
            {scans.map((scan) => (
              <button
                key={scan.id}
                type="button"
                role="listitem"
                className={`history-card ${viewingSavedScan?.id === scan.id ? 'active-history-card' : ''}`}
                onClick={() => openSavedScan(scan)}
                aria-label={`Open scan for ${scan.productName}`}
              >
                <span
                  className={`risk-dot ${
                    scan.overallRisk === 'high'
                      ? 'risk-high'
                      : scan.overallRisk === 'medium'
                      ? 'risk-medium'
                      : ''
                  }`}
                />
                <div className="history-product">
                  <strong>{scan.productName}</strong>
                  <span>
                    {scan.brand ? `${scan.brand} • ` : ''}
                    {scan.summary || `${scan.ingredients.length} ingredients`} • {formatScanDate(scan.createdAt)}
                  </span>
                </div>
                <span
                  className={`risk-label ${
                    scan.overallRisk === 'high'
                      ? 'risk-text-high'
                      : scan.overallRisk === 'medium'
                      ? 'risk-text-medium'
                      : ''
                  }`}
                >
                  {scan.overallRisk} risk
                </span>
                <span className="history-score">
                  {scan.safetyScore}
                  <small>/100</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>}
    </section>
  </main>
}

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/signup" element={<AuthPage mode="signup" />} />
    <Route path="/dashboard/*" element={<AuthGate><DashboardPage /></AuthGate>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
