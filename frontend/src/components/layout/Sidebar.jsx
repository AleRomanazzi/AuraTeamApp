import { NavLink } from 'react-router-dom'
import AURA_LOGO from '../../assets/logo-aura.png'
import { puede, useMe } from '../../hooks/useData'
import { nombreRoles } from '../../lib/constants'
import Icono from '../ui/Icono'

const NAV_ADMIN = [
  {
    section: null,
    items: [
      { to: '/', icon: 'inicio', label: 'Inicio' },
      { to: '/mi-panel', icon: 'persona', label: 'Mi panel' },
      { to: '/tareas', icon: 'tareas', label: 'Tareas' },
      { to: '/calendario', icon: 'calendario', label: 'Calendario' },
      { to: '/clientes', icon: 'clientes', label: 'Clientes' },
    ],
  },
  {
    section: 'Finanzas',
    items: [
      { to: '/cobros', icon: 'cobros', label: 'Cobros' },
      { to: '/movimientos', icon: 'movimientos', label: 'Movimientos' },
      { to: '/suscripciones', icon: 'suscripciones', label: 'Suscripciones' },
    ],
  },
  {
    section: 'Equipo',
    items: [
      { to: '/equipo-hoy', icon: 'pulso', label: 'Equipo hoy' },
      { to: '/equipo', icon: 'equipo', label: 'Personas' },
      { to: '/pagos-equipo', icon: 'recibo', label: 'Pagos al equipo' },
    ],
  },
  {
    section: 'Herramientas',
    items: [
      { to: '/gmail', icon: 'mail', label: 'Gmail' },
      { to: '/estadisticas', icon: 'grafico', label: 'Estadísticas' },
    ],
  },
]

function navEquipo(me) {
  return [
    {
      section: null,
      items: [
        { to: '/', icon: 'inicio', label: 'Mi panel' },
        { to: '/tareas', icon: 'tareas', label: 'Tareas' },
        { to: '/calendario', icon: 'calendario', label: 'Calendario' },
        puede(me, 'clientes') && { to: '/clientes', icon: 'clientes', label: 'Clientes' },
        puede(me, 'estadisticas') && { to: '/estadisticas', icon: 'grafico', label: 'Estadísticas' },
      ].filter(Boolean),
    },
  ]
}

export default function Sidebar({ sidebarOpen, onClose }) {
  const { data: me } = useMe()
  const nav = !me ? [] : me.es_admin ? NAV_ADMIN : navEquipo(me)

  return (
    <aside id="sidebar" className={sidebarOpen ? 'open' : ''} aria-label="Navegación principal">
      <div className="logo">
        <img className="logo-img" src={AURA_LOGO} alt="" />
        <div className="logo-text">
          <h1>AuraTeam</h1>
        </div>
        <button type="button" className="sidebar-close" aria-label="Cerrar menú" onClick={() => onClose?.()}>
          ×
        </button>
      </div>
      <nav>
        {nav.map((block) => (
          <div key={block.section ?? 'principal'}>
            {block.section ? <div className="nav-section">{block.section}</div> : null}
            {block.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                onClick={() => onClose?.()}
              >
                <span className="icon">
                  <Icono nombre={item.icon} />
                </span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {me ? (
        <div className="sidebar-footer">
          <NavLink to="/config" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={() => onClose?.()}>
            <span className="icon">
              <Icono nombre="config" />
            </span>
            {me.es_admin ? 'Configuración' : 'Mi cuenta'}
          </NavLink>
          <div className="sidebar-user">
            <strong>{me.persona_nombre || me.first_name || me.username}</strong>
            <span>{nombreRoles(me)}</span>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
