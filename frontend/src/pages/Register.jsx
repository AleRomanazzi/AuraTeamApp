import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { notify } from '../lib/notify'

export default function Register() {
  const access = useAuthStore((s) => s.access)
  const navigate = useNavigate()
  useEffect(() => {
    if (access) navigate('/', { replace: true })
  }, [access, navigate])

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const setTokens = useAuthStore((s) => s.setTokens)

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('auth/register/', { username, email, password })
      const { data } = await api.post('auth/login/', { username, password })
      setTokens(data.access, data.refresh)
      try {
        sessionStorage.setItem('aura_post_login_google', '1')
      } catch {
        /* ignore */
      }
      notify('Cuenta creada')
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : 'Error al registrar'
      notify(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page active" style={{ maxWidth: 420, margin: '48px auto', padding: '0 16px' }}>
      <div className="card" style={{ padding: 28 }}>
        <h2 style={{ marginBottom: 8 }}>Crear cuenta</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Mínimo 8 caracteres en la contraseña</p>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Usuario</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div className="form-row">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="form-row">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
            {loading ? 'Creando…' : 'Registrarme'}
          </button>
        </form>
        <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-dim)' }}>
          Ya tenés cuenta? <Link to="/login">Iniciá sesión</Link>
        </p>
      </div>
    </div>
  )
}
