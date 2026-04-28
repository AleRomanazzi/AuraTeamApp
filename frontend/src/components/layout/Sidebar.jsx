import { NavLink, useNavigate } from 'react-router-dom'
import AURA_LOGO from '../../assets/auraLogoSrc'

const nav = [
  { section: 'Principal', items: [{ to: '/', page: 'dashboard', icon: '📊', label: 'Dashboard' }] },
  {
    section: 'Finanzas',
    items: [
      { to: '/ingresos', page: 'ingresos', icon: '💰', label: 'Ingresos & Egresos' },
      { to: '/servicios', page: 'servicios', icon: '🔧', label: 'División de Servicios' },
    ],
  },
  {
    section: 'Personal',
    items: [
      { to: '/personal', page: 'personal', icon: '👥', label: 'Equipo' },
      { to: '/perfiles', page: 'perfil', icon: '🗂️', label: 'Perfiles & Tareas' },
    ],
  },
  {
    section: 'Productividad',
    items: [
      { to: '/gmail', page: 'gmail', icon: '✉️', label: 'Gmail' },
      { to: '/calendar', page: 'calendar', icon: '📅', label: 'Calendario' },
    ],
  },
  { section: 'Análisis', items: [{ to: '/estadisticas', page: 'estadisticas', icon: '📈', label: 'Estadísticas' }] },
  { section: 'Sistema', items: [{ to: '/config', page: 'config', icon: '⚙️', label: 'Configuración' }] },
]

export default function Sidebar({ sidebarOpen, onClose }) {
  const navigate = useNavigate()

  return (
    <aside id="sidebar" className={sidebarOpen ? 'open' : ''}>
      <div className="logo">
        <img className="logo-img" src={AURA_LOGO} alt="Aura Team" />
        <div className="logo-text">
          <h1>Aura Team</h1>
          <span>Centro de Control</span>
        </div>
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
                <span className="icon">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          type="button"
          className="config-btn"
          onClick={() => {
            navigate('/config')
            onClose?.()
          }}
        >
          🔑 Conectar Google APIs
        </button>
      </div>
    </aside>
  )
}
