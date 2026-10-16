import { useState, type FormEvent, type ReactNode } from 'react'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import { ArrowRight, Check, Eye, EyeOff, FlaskConical, Leaf, LockKeyhole, LogOut, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { auth, firebaseConfigured } from './firebase'

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
  const signupSuccess = (location.state as { signupSuccess?: boolean } | null)?.signupSuccess

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
    <header className="dashboard-header"><Brand /><div className="dashboard-user"><span className="user-avatar">{(user?.displayName || user?.email || 'D').charAt(0).toUpperCase()}</span><span className="user-email">{user?.displayName || user?.email}</span><button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="logout-button"><LogOut size={16} />{loggingOut ? 'Signing out...' : 'Log out'}</button></div></header>
    <section className="dashboard-content">
      <div className="dashboard-welcome"><span className="welcome-tag"><Sparkles size={13} /> DERMOBOT ACCOUNT</span><h1>{signupSuccess ? 'Your account is ready.' : 'Welcome back.'}</h1><p>Your Firebase Authentication session is active.</p></div>
      {signupSuccess && <p className="auth-message success" role="status"><Check size={16} /> Your Dermobot account was created successfully.</p>}
      {logoutError && <p className="auth-message error" role="alert">{logoutError}</p>}
      <div className="auth-session-card"><ShieldCheck size={21} /><div><strong>Signed in</strong><span>{user?.email}</span></div></div>
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
