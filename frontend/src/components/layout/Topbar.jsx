import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePhase1 } from '../../context/Phase1Context'
import { useAuthStore } from '../../store/authStore'

const titles = {
  '/': 'Dashboard',
  '/ingresos': 'Ingresos & Egresos',
  '/servicios': 'División de Servicios',
  '/personal': 'Equipo',
  '/perfiles': 'Perfiles & Tareas',
  '/gmail': 'Gmail',
  '/calendar': 'Calendario',
  '/estadisticas': 'Estadísticas',
  '/config': 'Configuración',
}

export default function Topbar({ onToggleSidebar }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { state } = usePhase1()
  const clearAuth = useAuthStore((s) => s.clearAuth)

  const title = titles[pathname] ?? 'Aura Team'

  const dateBadge = useMemo(() => {
    const now = new Date()
    return now.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
  }, [])

  const googleLine =
    state.googleConnected === true
      ? { text: '🟢 Google conectado', color: 'var(--accent)' }
      : { text: '⚪ Google desconectado', color: 'var(--text-dim)' }

  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div className="hamburger" onClick={onToggleSidebar} onKeyDown={(e) => e.key === 'Enter' && onToggleSidebar()} role="button" tabIndex={0}>
          <span />
          <span />
          <span />
        </div>
        <span className="topbar-title" id="topbar-title">
          {title}
        </span>
      </div>
      <div className="topbar-right">
        <span className="badge" id="date-badge">
          {dateBadge}
        </span>
        <span id="google-status" style={{ fontSize: '13px', color: googleLine.color }}>
          {googleLine.text}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginLeft: 8 }}
          onClick={() => {
            clearAuth()
            navigate('/login', { replace: true })
          }}
        >
          Salir
        </button>
      </div>
    </div>
  )
}
