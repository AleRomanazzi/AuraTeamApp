import { formatFechaCorta } from '../../lib/format'

/** Línea simple en SVG. `puntos`: [{ fecha, valor }] ordenados por fecha. */
export default function LineChart({ puntos, color = 'var(--accent)', alto = 120, formato = (n) => n.toLocaleString('es-AR') }) {
  if (!puntos.length) return null
  const ancho = 320
  const pad = 14
  const valores = puntos.map((p) => p.valor)
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const rango = max - min || 1
  const x = (i) => (puntos.length === 1 ? ancho / 2 : pad + (i * (ancho - pad * 2)) / (puntos.length - 1))
  const y = (v) => alto - pad - ((v - min) / rango) * (alto - pad * 2)
  const d = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="line-chart" role="img" aria-label="Evolución">
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      {puntos.map((p, i) => (
        <circle key={`${p.fecha}-${i}`} cx={x(i)} cy={y(p.valor)} r="3.5" fill={color}>
          <title>
            {formatFechaCorta(p.fecha)}: {formato(p.valor)}
          </title>
        </circle>
      ))}
    </svg>
  )
}
