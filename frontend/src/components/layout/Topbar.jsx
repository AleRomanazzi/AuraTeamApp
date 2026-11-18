import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import AURA_LOGO from '../../assets/logo-aura.png'
import { isSignedIn } from '../../features/google/gapiClient'
import { useGoogleStore } from '../../features/google/googleStore'
import { useMe } from '../../hooks/useData'
import Campana from './Campana'
import Icono from '../ui/Icono'
import { useTema } from '../../lib/tema'
import { cerrarSesion } from '../../lib/session'

const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Topbar({ onToggleSidebar, onBuscar }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const [saliendo, setSaliendo] = useState(false)
  const [tema, alternarTema] = useTema()
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
      <Link to="/" className="topbar-brand" aria-label="Inicio">
        <img src={AURA_LOGO} alt="" />
        <span>AuraTeam</span>
      </Link>
      <button type="button" className="topbar-buscar" onClick={onBuscar} aria-label="Buscar (Cmd+K)">
        <Icono nombre="buscar" size={15} />
        <span className="solo-escritorio">Buscar…</span>
        <kbd className="solo-escritorio">⌘K</kbd>
      </button>
      <div className="topbar-right">
        <span className="badge solo-escritorio">{hoy}</span>
        {me?.es_admin && me?.google_conectado ? (
          <span className="topbar-google" style={{ color: googleActivo ? 'var(--success)' : 'var(--text-dim)' }} title={googleActivo ? 'Google conectado' : 'Google sin sesión'}>
            {googleActivo ? '●' : '○'}
            <span className="solo-escritorio"> {googleActivo ? 'Google conectado' : 'Google sin sesión'}</span>
          </span>
        ) : null}
        {me ? <Campana /> : null}
        <button
          type="button"
          className="tema-switch"
          role="switch"
          aria-checked={tema === 'dark'}
          aria-label="Modo oscuro"
          title={tema === 'dark' ? 'Pasar a modo claro' : 'Pasar a modo oscuro'}
          onClick={alternarTema}
        >
          <span className="tema-switch-pista">
            <Icono nombre="sol" size={13} className="tema-switch-sol" />
            <Icono nombre="luna" size={13} className="tema-switch-luna" />
            <span className="tema-switch-perilla" />
          </span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={salir} disabled={saliendo} aria-label="Salir">
          <Icono nombre="salir" size={15} />
          <span className="solo-escritorio">{saliendo ? 'Saliendo…' : 'Salir'}</span>
        </button>
      </div>
    </header>
  )
}
