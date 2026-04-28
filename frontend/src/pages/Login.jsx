import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import AURA_LOGO from '../assets/auraLogoSrc'
import { api } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { notify } from '../lib/notify'

export default function Login() {
  const access = useAuthStore((s) => s.access)
  const navigate = useNavigate()
  useEffect(() => {
    if (access) navigate('/', { replace: true })
  }, [access, navigate])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const setTokens = useAuthStore((s) => s.setTokens)
  const loc = useLocation()
  const from = loc.state?.from || '/'

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('auth/login/', { username, password })
      setTokens(data.access, data.refresh)
      try {
        sessionStorage.setItem('aura_post_login_google', '1')
      } catch {
        /* ignore */
      }
      notify('Sesión iniciada')
      navigate(from, { replace: true })
    } catch {
      notify('Usuario o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page active" style={{ maxWidth: 420, margin: '48px auto', padding: '0 16px' }}>
      <div className="card" style={{ padding: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
          <img
            src={AURA_LOGO}
            alt="Aura Team"
            className="logo-img"
            style={{ width: 56, height: 56, marginBottom: 12 }}
          />
          <h2 style={{ marginBottom: 8, textAlign: 'center' }}>Iniciar sesión</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, textAlign: 'center' }}>
            Aura Team — Centro de Control
          </p>
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Usuario</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div className="form-row">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-dim)' }}>
          ¿No tenés cuenta? <Link to="/register">Registrate</Link>
        </p>
      </div>
    </div>
  )
}
