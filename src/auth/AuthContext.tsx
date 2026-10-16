import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, setPersistence, browserLocalPersistence, type User } from 'firebase/auth'
import { auth } from '../firebase'

interface AuthState {
  user: User | null
  loading: boolean
}

const AuthContext = createContext<AuthState>({ user: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const firebaseAuth = auth
    if (!firebaseAuth) {
      setLoading(false)
      return
    }
    let active = true
    let unsubscribe: (() => void) | undefined
    void setPersistence(firebaseAuth, browserLocalPersistence)
      .catch((error: unknown) => console.error('Unable to set Firebase session persistence', error))
      .finally(() => {
        if (!active) return
        unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
          if (!active) return
          setUser(nextUser)
          setLoading(false)
        }, () => {
          if (!active) return
          setUser(null)
          setLoading(false)
        })
      })
    return () => { active = false; unsubscribe?.() }
  }, [])

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
