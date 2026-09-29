import { fmtCorto } from '../../lib/format'

/**
 * Gráfico de barras agrupadas sin dependencias.
 * @param {{ data: { label: string, valores: { valor: number, color: string, nombre: string }[] }[], alto?: number, formato?: (n:number)=>string }} props
 */
export default function BarChart({ data, alto = 140, formato = fmtCorto }) {
  const max = Math.max(1, ...data.flatMap((d) => d.valores.map((v) => Math.abs(Number(v.valor) || 0))))
  const series = data[0]?.valores.map((v) => ({ nombre: v.nombre, color: v.color })) ?? []
  return (
    <div>
      <div className="chart-bar-wrap" style={{ height: alto }} role="img" aria-label="Gráfico de barras">
        {data.map((d) => (
          <div key={d.label} className="chart-bar-col">
            <div className="chart-bar-group">
              {d.valores.map((v) => {
                const h = Math.max(2, (Math.abs(Number(v.valor) || 0) / max) * (alto - 24))
                return (
                  <div
                    key={v.nombre}
                    className="chart-bar"
                    style={{ height: h, background: v.color }}
                    title={`${v.nombre} ${d.label}: ${formato(v.valor)}`}
                  />
                )
              })}
            </div>
            <div className="chart-bar-label">{d.label}</div>
          </div>
        ))}
      </div>
      {series.length > 1 ? (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.nombre}>
              <i style={{ background: s.color }} /> {s.nombre}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
