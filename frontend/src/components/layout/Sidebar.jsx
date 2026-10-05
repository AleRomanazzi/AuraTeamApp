import { NavLink } from 'react-router-dom'
import AURA_LOGO from '../../assets/logo-aura.png'
import { puede, useMe } from '../../hooks/useData'
import { nombreRoles } from '../../lib/constants'

const NAV_ADMIN = [
  { section: 'Principal', items: [{ to: '/', icon: '📊', label: 'Dashboard' }] },
  {
    section: 'Clientes',
    items: [
      { to: '/clientes', icon: '🏷️', label: 'Clientes' },
      { to: '/cobros', icon: '💵', label: 'Cobros' },
    ],
  },
  {
    section: 'Finanzas',
    items: [
      { to: '/movimientos', icon: '💰', label: 'Movimientos' },
      { to: '/suscripciones', icon: '🔁', label: 'Suscripciones' },
    ],
  },
  {
    section: 'Equipo',
    items: [
      { to: '/equipo-hoy', icon: '🚦', label: 'Equipo hoy' },
      { to: '/equipo', icon: '👥', label: 'Equipo' },
      { to: '/pagos-equipo', icon: '🧾', label: 'Pagos al equipo' },
      { to: '/tareas', icon: '✅', label: 'Tareas' },
    ],
  },
  {
    section: 'Productividad',
    items: [
      { to: '/calendario', icon: '📅', label: 'Calendario' },
      { to: '/gmail', icon: '✉️', label: 'Gmail' },
      { to: '/estadisticas', icon: '📈', label: 'Estadísticas' },
    ],
  },
  { section: 'Sistema', items: [{ to: '/config', icon: '⚙️', label: 'Configuración' }] },
]

function navEquipo(me) {
  const clientes = [
    puede(me, 'clientes') && { to: '/clientes', icon: '🏷️', label: 'Clientes' },
    puede(me, 'estadisticas') && { to: '/estadisticas', icon: '📈', label: 'Estadísticas' },
  ].filter(Boolean)
  return [
    {
      section: 'Mi trabajo',
      items: [
        { to: '/', icon: '🏠', label: 'Mi panel' },
        { to: '/tareas', icon: '✅', label: 'Tareas' },
        { to: '/calendario', icon: '📅', label: 'Calendario' },
      ],
    },
    ...(clientes.length ? [{ section: 'Clientes', items: clientes }] : []),
    { section: 'Cuenta', items: [{ to: '/config', icon: '⚙️', label: 'Mi cuenta' }] },
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
          <span>Centro de control</span>
        </div>
        <button type="button" className="sidebar-close" aria-label="Cerrar menú" onClick={() => onClose?.()}>
          ×
        </button>
      </div>
      <nav>
        {nav.map((block) => (
          <div key={block.section}>
            <div className="nav-section">{block.section}</div>
            {block.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                onClick={() => onClose?.()}
              >
                <span className="icon" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {me ? (
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <strong>{me.persona_nombre || me.first_name || me.username}</strong>
            <span>{nombreRoles(me)}</span>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
