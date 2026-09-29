import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import QueryState from '../components/ui/QueryState'
import { api } from '../lib/api'
import { MEDIOS_PAGO, labelDe } from '../lib/constants'
import { fmt, formatFecha, monthLabel } from '../lib/format'
import { num } from '../lib/money'

export default function Recibo() {
  const { id } = useParams()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['liquidaciones', 'detalle', id], queryFn: () => api.get(`liquidaciones/${id}/`).then((r) => r.data) })

  return (
    <>
      <div className="no-print report-toolbar">
        <button type="button" className="back-link link-btn" onClick={() => navigate(-1)}>
          ← Volver
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          🖨 Imprimir / PDF
        </button>
      </div>
      <QueryState query={q}>
        {(l) => (
          <article className="report recibo">
            <header className="report-head">
              <div>
                <div className="report-brand">AURA TEAM</div>
                <h1>Comprobante de pago</h1>
                <div className="muted">N.º {String(l.id).padStart(6, '0')}</div>
              </div>
              <div className="recibo-estado">{l.estado === 'pagada' ? 'PAGADO' : l.estado.toUpperCase()}</div>
            </header>
            <dl className="data-list">
              <div>
                <dt>Pagado a</dt>
                <dd>
                  <strong>{l.persona_nombre}</strong>
                  {l.persona_cuit ? ` · CUIT ${l.persona_cuit}` : ''}
                </dd>
              </div>
              <div>
                <dt>Período</dt>
                <dd>{monthLabel(l.periodo)}</dd>
              </div>
              <div>
                <dt>Concepto</dt>
                <dd>
                  {l.concepto}
                  {l.cliente_nombre && !l.concepto.includes(l.cliente_nombre) ? ` — ${l.cliente_nombre}` : ''}
                </dd>
              </div>
              <div>
                <dt>Fecha de pago</dt>
                <dd>{l.fecha_pago ? formatFecha(l.fecha_pago) : '—'}</dd>
              </div>
              <div>
                <dt>Medio</dt>
                <dd>
                  {l.medio_pago ? labelDe(MEDIOS_PAGO, l.medio_pago) : '—'}
                  {l.persona_alias_cbu ? ` · ${l.persona_alias_cbu}` : ''}
                  {l.comprobante ? ` · Op. ${l.comprobante}` : ''}
                </dd>
              </div>
            </dl>
            <table>
              <thead>
                <tr>
                  <th>Detalle</th>
                  <th className="num">Cant.</th>
                  <th className="num">Unitario</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {num(l.monto_base) ? (
                  <tr>
                    <td>{l.origen === 'base' ? 'Honorario base' : 'Monto base'}</td>
                    <td className="num">1</td>
                    <td className="num">{fmt(l.monto_base)}</td>
                    <td className="num">{fmt(l.monto_base)}</td>
                  </tr>
                ) : null}
                {l.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.concepto}</td>
                    <td className="num">{num(i.cantidad).toLocaleString('es-AR')}</td>
                    <td className="num">{fmt(i.monto_unitario)}</td>
                    <td className="num">{fmt(i.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>Total</th>
                  <th className="num">{fmt(l.total)}</th>
                </tr>
              </tfoot>
            </table>
            {l.notas ? <p className="pre-wrap muted">{l.notas}</p> : null}
            <div className="firma">
              <div>
                <div className="firma-linea" />
                Firma
              </div>
              <div>
                <div className="firma-linea" />
                Aclaración
              </div>
            </div>
          </article>
        )}
      </QueryState>
    </>
  )
}
