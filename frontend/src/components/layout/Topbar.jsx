import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { isSignedIn } from '../../features/google/gapiClient'
import { useGoogleStore } from '../../features/google/googleStore'
import { useMe } from '../../hooks/useData'
import { cerrarSesion } from '../../lib/session'

const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Topbar({ onToggleSidebar }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const [saliendo, setSaliendo] = useState(false)
  useGoogleStore((s) => s.tokenVersion)
  const googleActivo = Boolean(me?.google_conectado) && isSignedIn()

  const salir = async () => {
    setSaliendo(true)
    await cerrarSesion(qc)
    navigate('/login', { replace: true })
  }

  return (
    <header className="topbar">
      <button type="button" className="hamburger" aria-label="Abrir menú" onClick={onToggleSidebar}>
        <span />
        <span />
        <span />
      </button>
      <div className="topbar-right">
        <span className="badge">{hoy}</span>
        {me?.es_admin && me?.google_conectado ? (
          <span className="topbar-google" style={{ color: googleActivo ? 'var(--accent)' : 'var(--text-dim)' }}>
            {googleActivo ? '● Google conectado' : '○ Google sin sesión'}
          </span>
        ) : null}
        <button type="button" className="btn btn-secondary btn-sm" onClick={salir} disabled={saliendo}>
          {saliendo ? 'Saliendo…' : 'Salir'}
        </button>
      </div>
    </header>
  )
}
