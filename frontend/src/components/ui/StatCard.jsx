import { fmtPct } from '../../lib/format'

/**
 * @param {{ label: string, value: React.ReactNode, sub?: React.ReactNode, color?: 'green'|'purple'|'red'|'gold',
 *   variacion?: number|null, invertir?: boolean, onClick?: () => void }} props
 * `invertir` pinta en verde las bajas (útil para egresos).
 */
export default function StatCard({ label, value, sub, color = 'green', variacion, invertir = false, onClick }) {
  const tieneVar = variacion !== undefined && variacion !== null
  const positivo = tieneVar && (invertir ? variacion < 0 : variacion > 0)
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`stat-card ${color}${onClick ? ' stat-card--click' : ''}`} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {tieneVar ? (
        <div className={`stat-sub ${positivo ? 'up' : 'down'}`}>
          {fmtPct(variacion)} <span className="muted">vs. mes anterior</span>
        </div>
      ) : null}
      {sub ? <div className="stat-sub muted">{sub}</div> : null}
    </Tag>
  )
}
