import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AURA_LOGO from '../assets/logo-aura.png'
import { api } from '../lib/api'
import { apiErrorMessage } from '../lib/errors'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const access = useAuthStore((s) => s.access)
  const setTokens = useAuthStore((s) => s.setTokens)
  const navigate = useNavigate()
  const loc = useLocation()
  const from = loc.state?.from || '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (access) navigate(from, { replace: true })
  }, [access, from, navigate])

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('auth/login/', { username: username.trim(), password })
      setTokens(data.access, data.refresh)
    } catch (err) {
      const status = err.response?.status
      setError(status === 401 || status === 400 ? 'Usuario o contraseña incorrectos.' : apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="login-head">
          <img src={AURA_LOGO} alt="" className="logo-img" />
          <p>AuraTeam · Centro de control</p>
          <h2>Iniciar sesión</h2>
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label htmlFor="login-user">Usuario</label>
            <input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
          </div>
          <div className="form-row">
            <label htmlFor="login-pass">Contraseña</label>
            <input id="login-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
