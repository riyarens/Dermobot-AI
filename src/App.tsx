import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import { ArrowRight, Check, Eye, EyeOff, FlaskConical, ImagePlus, Leaf, LockKeyhole, LogOut, Mail, ShieldCheck, Sparkles, Upload, X, Copy, RotateCcw } from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { auth, db, firebaseConfigured } from './firebase'
import {
  type IngredientScreening,
  type ScanRecord,
  calculateSafetyScore,
  getUserScanHistory,
  saveScanRecord,
} from './lib/scanService'

type Mode = 'login' | 'signup'


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
      setError(firebaseMessage(code))
    } finally {
      setBusy(false)
    }
  }

  function changeMode(next: Mode) {
    setError('')
    setInfo('')
    navigate(next === 'signup' ? '/signup' : '/login')
  }

  return <main className="page-shell" id="home">
    <section className="visual-panel" aria-label="About Dermobot">
      <div className="visual-grain" />
      <header className="visual-header"><Brand /><span className="header-note">SKINCARE, MADE CLEAR</span></header>
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-line" /> YOUR SKIN. YOUR RULES.</div>
        <h1>Feel good<br />about what<br /><em>goes on</em> your skin.</h1>
        <p>Decode ingredients, spot potential irritants, and find a routine that feels like you.</p>
      </div>
      <div className="scan-card" aria-label="Example ingredient safety scan">
        <div className="scan-card-top"><span className="scan-icon"><FlaskConical size={16} /></span><span>INGREDIENT CHECK</span><span className="scan-dots">•••</span></div>
        <div className="scan-product"><div className="product-bottle"><span className="bottle-cap" /><span className="bottle-label">daily<br />glow</span></div><div><span className="product-caption">YOUR PRODUCT</span><strong>Daily Glow Serum</strong><span className="product-meta">30 ml · Face serum</span></div><span className="safe-badge"><Check size={12} /> LOOKS GOOD</span></div>
        <div className="scan-divider" />
        <div className="scan-result"><div className="score-ring"><span>92</span><small>/100</small></div><div className="result-copy"><strong>Skin-friendly score</strong><span>3 ingredients checked</span><div className="ingredient-chips"><span><i /> Niacinamide</span><span><i /> Squalane</span></div></div><ShieldCheck className="result-shield" size={22} /></div>
      </div>
      <div className="trust-note"><span className="trust-icon"><ShieldCheck size={15} /></span><span>Science-backed insights, made for real life.</span></div>
      <div className="decor decor-one" /><div className="decor decor-two" /><div className="decor decor-three" />
    </section>

    <section className="form-panel">
      <div className="mobile-brand"><Brand /></div>
      <div className="form-wrap">
        <div className="form-intro"><span className="welcome-tag"><Sparkles size={13} /> A LITTLE MORE CLARITY</span><h2>{isSignup ? 'Your skin journey,' : 'Good to see you,'}<br /><span>{isSignup ? 'starts here.' : 'again.'}</span></h2><p>{isSignup ? 'Create your free account and make every skincare choice a little more confident.' : 'Sign in to pick up where your skin journey left off.'}</p></div>
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
          <button className="submit-button" type="submit" disabled={busy}><span>{busy ? <><span className="button-spinner" /> {isSignup ? 'Creating account...' : 'Signing in...'}</> : isSignup ? 'Create your account' : 'Log in to Dermobot'}</span>{!busy && <ArrowRight size={18} />}</button>
          {error && <p className="auth-message error" role="alert">{error}</p>}
          {info && <p className="auth-message success" role="status"><Check size={16} />{info}</p>}
        </form>
        <p className="switch-prompt">{isSignup ? 'Already have an account?' : 'New to Dermobot?'} <button type="button" onClick={() => changeMode(isSignup ? 'login' : 'signup')}>{isSignup ? 'Log in' : 'Create an account'}</button></p>
      </div>
      <footer className="form-footer"><span>© 2026 Dermobot</span><span className="footer-links"><a href="#privacy">Privacy</a><a href="#help">Help center</a></span><span className="footer-status"><i /> All systems healthy</span></footer>
    </section>
  </main>
}

function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState('')
  const [extractedText, setExtractedText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const [analysis, setAnalysis] = useState<IngredientScreening[] | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [productName, setProductName] = useState('')
  const [brand, setBrand] = useState('')
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
        setScans(records)
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
    loadHistory()
  }, [user])

  function chooseImage(file?: File) {
    setOcrError('')
    setCopied(false)
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
    setAnalysisError('')
    if (!productName.trim()) {
      const suggestedName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
      setProductName(suggestedName)
    }
  }

  async function extractIngredients() {
    if (!selectedImage || ocrLoading) return
    setOcrLoading(true)
    setOcrError('')
    setExtractedText('')
    setAnalysis(null)
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
      const payload = await response.json() as { text?: string; error?: string }
      if (!response.ok) throw new Error(payload.error || 'OCR request failed')
      const text = (payload.text ?? '').trim()
      if (!text) setOcrError('No readable text was found. Try a sharper, well-lit photo with the ingredient list in focus.')
      else setExtractedText(text)
    } catch (caught) {
      setOcrError(caught instanceof Error ? caught.message : 'We could not read this image. Please try again or upload a clearer photo.')
    } finally {
      setOcrLoading(false)
    }
  }

  async function analyzeIngredients() {
    if (!extractedText.trim() || analysisLoading) return
    setAnalysisLoading(true)
    setAnalysisError('')
    setAnalysis(null)
    try {
      if (!auth?.currentUser) throw new Error('Your session has expired. Please sign in again.')
      const token = await auth.currentUser.getIdToken()
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: extractedText }) })
      const payload = await response.json() as { items?: IngredientScreening[]; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Ingredient screening failed')
      const items = payload.items ?? []
      setAnalysis(items)

      // Save scan results to Firestore if not already saved (prevents duplicate saves)
      if (auth.currentUser && db && items.length > 0) {
        const fallbackName = selectedImage?.name
          ? selectedImage.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
          : 'Product Scan'
        const finalProdName = productName.trim() || fallbackName
        const currentSignature = `${auth.currentUser.uid}_${extractedText.trim()}_${finalProdName}_${brand.trim()}`
        if (savedScanSignature.current !== currentSignature) {
          try {
            setSavingScan(true)
            const savedRecord = await saveScanRecord(db, auth.currentUser.uid, {
              productName: finalProdName,
              brand: brand.trim(),
              extractedText,
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

  async function copyIngredients() {
    try { await navigator.clipboard.writeText(extractedText); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }
    catch { setOcrError('Clipboard access is unavailable. Select and copy the text manually.') }
  }

  function resetScan() {
    if (preview) URL.revokeObjectURL(preview)
    setSelectedImage(null)
    setPreview('')
    setExtractedText('')
    setOcrError('')
    setAnalysis(null)
    setAnalysisError('')
    setViewingSavedScan(null)
    setProductName('')
    setBrand('')
    setSaveMessage('')
    if (fileInput.current) fileInput.current.value = ''
  }

  function openSavedScan(scan: ScanRecord) {
    setViewingSavedScan(scan)
    setExtractedText(scan.extractedText || scan.ingredients.join(', '))
    setAnalysis(scan.riskClassifications)
    setProductName(scan.productName)
    setBrand(scan.brand)
    setOcrError('')
    setAnalysisError('')
    savedScanSignature.current = `${user?.uid}_${(scan.extractedText || '').trim()}_${scan.productName.trim()}_${scan.brand.trim()}`
    const resultsEl = document.getElementById('results-card')
    if (resultsEl) {
      resultsEl.scrollIntoView({ behavior: 'smooth' })
    }
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
    <header className="dashboard-header"><Brand /><nav className="dashboard-nav" aria-label="Main navigation"><Link to="/dashboard" aria-current="page">Dashboard</Link></nav><div className="dashboard-user"><span className="user-avatar">{(user?.displayName || user?.email || 'D').charAt(0).toUpperCase()}</span><span className="user-email">{user?.displayName || user?.email}</span><button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="logout-button"><LogOut size={16} />{loggingOut ? 'Signing out...' : 'Log out'}</button></div></header>
    <section className="dashboard-content scanner-content">
      <div className="dashboard-welcome"><span className="welcome-tag"><Sparkles size={13} /> YOUR SKINCARE, MADE CLEAR</span><h1>Know What Goes Into<br className="desktop-break" /> Your Skincare.</h1><p>Upload a product ingredient list, review the extracted text, then get a general AI screening of potential ingredient concerns.</p></div>
      {signupSuccess && <p className="auth-message success" role="status"><Check size={16} /> Your Dermobot account was created successfully.</p>}
      {logoutError && <p className="auth-message error" role="alert">{logoutError}</p>}
      <section className="scanner-card" aria-labelledby="scan-title">
        <div className="scanner-card-heading"><span className="upload-icon"><ImagePlus size={20} /></span><div><h2 id="scan-title">Scan Your Ingredient List</h2><p>Upload a clear photo of the ingredients printed on your product packaging.</p></div></div>
        <div className={`drop-zone ${dragging ? 'drop-zone-active' : ''} ${preview ? 'has-preview' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseImage(event.dataTransfer.files[0]) }}>
          <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => chooseImage(event.target.files?.[0])} />
          {preview ? <><img src={preview} alt="Selected ingredient list preview" className="image-preview" /><button type="button" className="remove-image" aria-label="Remove selected image" onClick={resetScan}><X size={16} /></button><div className="preview-name">{selectedImage?.name}</div></> : <><span className="drop-icon"><Upload size={21} /></span><strong>Drop your image here</strong><span className="drop-support">or browse a file from your device</span><button className="browse-button" type="button" onClick={() => fileInput.current?.click()}>Choose image</button></>}
        </div>
        <div className="upload-meta"><span>JPG, PNG, WEBP</span><span>Maximum file size: 10 MB</span></div>
        <div className="product-meta-inputs">
          <div className="meta-input-field">
            <label htmlFor="prod-name">Product Name (optional)</label>
            <input
              id="prod-name"
              type="text"
              placeholder="e.g. Daily Glow Serum"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              disabled={ocrLoading || analysisLoading}
            />
          </div>
          <div className="meta-input-field">
            <label htmlFor="prod-brand">Brand / Manufacturer (optional)</label>
            <input
              id="prod-brand"
              type="text"
              placeholder="e.g. CeraVe, The Ordinary"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              disabled={ocrLoading || analysisLoading}
            />
          </div>
        </div>
        {ocrError && <p className="auth-message error scanner-message" role="alert">{ocrError}</p>}
        <button type="button" className="extract-button" disabled={!selectedImage || ocrLoading} onClick={() => void extractIngredients()}>{ocrLoading ? <><span className="button-spinner" /> Reading your ingredient list...</> : <><Sparkles size={16} /> Extract Ingredients <ArrowRight size={16} /></>}</button>
      </section>
      <section className="results-card" id="results-card" aria-labelledby="results-title">
        <div className="results-heading"><div><span className="results-kicker">YOUR SCAN</span><h2 id="results-title">Extracted Ingredients</h2></div>{extractedText && <button type="button" className="copy-button" onClick={() => void copyIngredients()}><Copy size={14} />{copied ? 'Copied' : 'Copy Ingredients'}</button>}</div>
        {viewingSavedScan && (
          <div className="saved-scan-banner" role="status">
            <div className="saved-scan-meta">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="saved-badge-tag"><Check size={12} /> Saved Report</span>
                <strong>{viewingSavedScan.productName}</strong>
                {viewingSavedScan.brand && <span style={{ color: '#687765' }}>({viewingSavedScan.brand})</span>}
              </div>
              <span>
                Saved {formatScanDate(viewingSavedScan.createdAt)} • Safety score: <strong>{viewingSavedScan.safetyScore}/100</strong> ({viewingSavedScan.overallRisk} risk)
              </span>
            </div>
            <button type="button" className="close-scan-btn" onClick={closeSavedScan}>
              <RotateCcw size={13} /> New scan
            </button>
          </div>
        )}
        {extractedText ? <><p className="results-note">Check the transcription against the package. For best results, upload a sharp, well-lit image with the full ingredient list in frame.</p><pre className="extracted-text extracted-readonly" aria-label="Extracted ingredient text">{extractedText}</pre><div className="result-footer"><span>Image text extracted by Gemini</span><button className="reset-button" type="button" onClick={resetScan}><RotateCcw size={14} /> Scan another image</button></div>{!viewingSavedScan && <div className="analysis-action"><div><strong>Ingredient screening</strong><span>Get a general AI estimate of potential concerns.</span></div><button className="extract-button analyze-button" type="button" disabled={analysisLoading || !extractedText.trim()} onClick={() => void analyzeIngredients()}>{analysisLoading ? <><span className="button-spinner" /> Reviewing ingredients...</> : <><ShieldCheck size={16} /> Categorize risks <ArrowRight size={16} /></>}</button></div>}{analysisError && <p className="auth-message error scanner-message" role="alert">{analysisError}</p>}{analysis && <div className="analysis-results"><div className="analysis-summary"><div><strong>Potential concern screening</strong>{viewingSavedScan && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#57734f' }}>• Score: {viewingSavedScan.safetyScore}/100</span>}</div><span>{analysis.length} ingredients reviewed</span></div>{(() => { const { score, overallRisk } = calculateSafetyScore(analysis); return <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}><span className="history-score" style={{ fontSize: '15px', color: '#33503a' }}>{viewingSavedScan ? viewingSavedScan.safetyScore : score}<small>/100</small></span><span className={`screening-badge screening-${viewingSavedScan ? viewingSavedScan.overallRisk : overallRisk}`}>Overall {viewingSavedScan ? viewingSavedScan.overallRisk : overallRisk} concern</span>{savingScan && <span style={{ fontSize: '10px', color: '#688460', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span className="spinner" style={{ width: '10px', height: '10px' }} /> Saving to history...</span>}{saveMessage && <span style={{ fontSize: '10px', color: '#4f7449' }}>• {saveMessage}</span>}</div> })()}<div className="analysis-totals"><span className="screening-badge screening-low">Low {analysis.filter((item) => item.level === 'low').length}</span><span className="screening-badge screening-medium">Medium {analysis.filter((item) => item.level === 'medium').length}</span><span className="screening-badge screening-high">High {analysis.filter((item) => item.level === 'high').length}</span></div><p className="analysis-disclaimer">AI-generated general screening only. Ingredient risk depends on concentration, formula, how the product is used, and individual sensitivity. This is not medical advice or a regulatory assessment.</p><div className="ingredient-screenings">{analysis.map((item, index) => <article className="ingredient-screening" key={`${index}-${item.ingredient}`}><div className="ingredient-screening-title"><strong>{item.ingredient}</strong><span className={`screening-badge screening-${item.level}`}>{item.level} potential concern</span></div><p>{item.reason}</p><span className="screening-confidence">AI confidence: {item.confidence}</span></article>)}</div>{!viewingSavedScan && <button type="button" className="reset-button rerun-button" onClick={() => void analyzeIngredients()} disabled={analysisLoading}><RotateCcw size={14} /> Re-run screening</button>}</div>}</> : <div className="results-empty"><span className="empty-result-icon"><FlaskConical size={19} /></span><strong>Your extracted text will appear here</strong><span>Upload an ingredient list image to get started. The transcription appears here for reference and copying.</span></div>}
      </section>

      <section className="history-section" aria-labelledby="history-title">
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
            <span>Upload an ingredient list image above to analyze risks. Your scans will be automatically saved here.</span>
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
      </section>
    </section>
  </main>
}

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/signup" element={<AuthPage mode="signup" />} />
    <Route path="/dashboard" element={<AuthGate><DashboardPage /></AuthGate>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
