import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePhase1 } from '../context/Phase1Context'
import { listPrimaryMonthEvents } from '../features/google/calendarApi'
import { isSignedIn } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { fmt, parseFrom } from '../lib/format'
import { monthlyEquivalentMonto } from '../lib/serviciosAmounts'
import { notify } from '../lib/notify'
import { QK } from '../lib/queryKeys'

export default function Dashboard() {
  const { state, refetchAll } = usePhase1()
  const inboxGoogle = useGoogleStore((s) => s.inboxPreview)
  const googleTokenVersion = useGoogleStore((s) => s.tokenVersion)
  const cur = state.config.moneda

  const now = useMemo(() => new Date(), [])
  const monthAnchor = useMemo(() => {
    const d = new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  }, [])

  const googleDashQ = useQuery({
    queryKey: [...QK.googleCal(monthAnchor.y, monthAnchor.m), googleTokenVersion],
    queryFn: () => listPrimaryMonthEvents({ year: monthAnchor.y, month: monthAnchor.m }),
    enabled: isSignedIn(),
    staleTime: 60_000,
  })
  const mes = now.toISOString().slice(0, 7)

  const { ing, eg, bal, srvTotal, chartHtml, movimientosHtml, eventsHtml, emailsHtml } = useMemo(() => {
    const googleMonthEvents = googleDashQ.data ?? []
    const txsMes = state.transacciones.filter((t) => t.fecha.startsWith(mes))
    const ingV = txsMes.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0)
    const egV = txsMes.filter((t) => t.tipo === 'egreso').reduce((s, t) => s + t.monto, 0)
    const balV = ingV - egV

    const srvTotalV = state.servicios.reduce((acc, s) => acc + monthlyEquivalentMonto(s.monto, s.periodo), 0)

    const months = []
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('es', { month: 'short' }) })
    }
    const maxVal = Math.max(
      ...months.map((m) => {
        const txs = state.transacciones.filter((t) => t.fecha.startsWith(m.key))
        return Math.max(
          txs.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0),
          txs.filter((t) => t.tipo === 'egreso').reduce((s, t) => s + t.monto, 0),
        )
      }),
      1,
    )

    const chart = months
      .map((m) => {
        const txs = state.transacciones.filter((t) => t.fecha.startsWith(m.key))
        const mi = txs.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0)
        const me = txs.filter((t) => t.tipo === 'egreso').reduce((s, t) => s + t.monto, 0)
        return `<div class="chart-bar-col"><div class="chart-bar" style="height:${((mi / maxVal) * 100).toFixed(0)}px;background:var(--accent);opacity:0.8;"></div><div class="chart-bar" style="height:${((me / maxVal) * 100).toFixed(0)}px;background:var(--accent3);opacity:0.8;"></div><div class="chart-bar-label">${m.label}</div></div>`
      })
      .join('')

    const last5 = state.transacciones.slice(0, 5)
    const mov =
      last5.length > 0
        ? last5
            .map(
              (t) =>
                `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);"><div><div style="font-size:14px;font-weight:500;color:var(--text);">${t.desc}</div><div style="font-size:11px;color:var(--text-dim);">${t.fecha} · ${t.cat}</div></div><div style="font-family:var(--font-mono);font-weight:600;color:${t.tipo === 'ingreso' ? 'var(--accent)' : 'var(--accent3)'};">${t.tipo === 'ingreso' ? '+' : '-'}${fmt(t.monto, cur)}</div></div>`,
            )
            .join('')
        : '<div style="color:var(--text-muted);font-size:13px;padding:20px 0;text-align:center;">Sin movimientos</div>'

    const evParts = [
      ...state.calClientes.slice(0, 3).map(
        (c) =>
          `<div class="cal-event" style="margin-bottom:6px;"><div class="cal-dot" style="background:${c.color};"></div><div style="font-size:13px;"><strong style="color:var(--text);">${c.titulo}</strong> <span style="color:var(--text-dim);">— día ${c.diaMes}</span></div></div>`,
      ),
      ...state.calEventos.slice(0, 2).map(
        (e) =>
          `<div class="cal-event" style="margin-bottom:6px;"><div class="cal-dot" style="background:${e.color};"></div><div style="font-size:13px;">${e.titulo}</div></div>`,
      ),
      ...googleMonthEvents.slice(0, 2).map((e) => {
        const cal = e.calendario ? ` <span style="color:var(--text-dim)">· ${String(e.calendario).replace(/</g, '')}</span>` : ''
        return `<div class="cal-event" style="margin-bottom:6px;"><div class="cal-dot" style="background:#4fc3f7;"></div><div style="font-size:13px;"><span style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Google</span> ${e.titulo}${cal}</div></div>`
      }),
    ]
    let ev = evParts.join('')
    if (!ev) {
      ev =
        '<div style="color:var(--text-muted);font-size:13px;padding:20px 0;text-align:center;">Añadí eventos en Calendario o cargá Google desde esa página.</div>'
    }

    const prevEmails = inboxGoogle.length > 0 ? inboxGoogle.slice(0, 3) : (state.gmailPreview?.slice(0, 3) ?? [])
    const em =
      prevEmails.length > 0
        ? prevEmails
            .map((e) => {
              const fromLine = inboxGoogle.length > 0 ? parseFrom(e.from || '') : e.from?.split('<')[0]?.replace(/"/g, '')?.trim() || ''
              return `<div style="padding:10px 0;border-bottom:1px solid var(--border);"><div style="font-size:13px;font-weight:${e.unread ? '600' : '400'};color:${e.unread ? 'var(--text)' : 'var(--text-muted)'};">${e.subject || '(Sin asunto)'}</div><div style="font-size:11px;color:var(--text-dim);">${fromLine}</div></div>`
            })
            .join('')
        : '<div style="color:var(--text-muted);font-size:13px;padding:20px 0;text-align:center;">Conectá Gmail y actualizá la bandeja en la página Gmail.</div>'

    return {
      ing: ingV,
      eg: egV,
      bal: balV,
      srvTotal: srvTotalV,
      chartHtml: chart,
      movimientosHtml: mov,
      eventsHtml: ev,
      emailsHtml: em,
    }
  }, [state, mes, cur, now, inboxGoogle, googleDashQ.data])

  const handleRefetch = async () => {
    try {
      await refetchAll()
      notify('Datos actualizados')
    } catch {
      notify('Error al actualizar')
    }
  }

  return (
    <div className="page active" id="page-dashboard">
      <div className="section-header">
        <div>
          <h2>Bienvenido de vuelta 👋</h2>
          <p>Resumen de tu situación financiera</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleRefetch}>
          🔄 Actualizar
        </button>
      </div>
      <div className="grid-4" style={{ marginBottom: '24px' }}>
        <div className="stat-card green">
          <div className="stat-label">Ingresos del mes</div>
          <div className="stat-value" id="dash-ingresos">
            {fmt(ing, cur)}
          </div>
          <div className="stat-sub up" id="dash-ing-pct">
            ↑ 0%
          </div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Egresos del mes</div>
          <div className="stat-value" id="dash-egresos">
            {fmt(eg, cur)}
          </div>
          <div className="stat-sub down">↓ 0%</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Balance neto</div>
          <div className="stat-value" id="dash-balance" style={{ color: bal >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
            {fmt(Math.abs(bal), cur)}
          </div>
          <div className="stat-sub" id="dash-bal-note" style={{ color: 'var(--text-muted)' }}>
            {bal >= 0 ? '✓ Positivo' : '⚠️ Negativo'}
          </div>
        </div>
        <div className="stat-card gold">
          <div className="stat-label">Servicios (total mensual)</div>
          <div className="stat-value" id="dash-servicios">
            {fmt(srvTotal, cur)}
          </div>
          <div className="stat-sub" style={{ color: 'var(--text-muted)' }}>
            Equivalente mensual de todos los montos
          </div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <span className="dot" />
            Flujo mensual
          </div>
          <div className="chart-bar-wrap" id="dash-chart" dangerouslySetInnerHTML={{ __html: chartHtml }} />
        </div>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent2)' }} />
            Próximos eventos
          </div>
          <div id="dash-events" dangerouslySetInnerHTML={{ __html: eventsHtml }} />
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--gold)' }} />
            Últimos movimientos
          </div>
          <div id="dash-movimientos" dangerouslySetInnerHTML={{ __html: movimientosHtml }} />
        </div>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent3)' }} />
            Correos recientes
          </div>
          <div id="dash-emails" dangerouslySetInnerHTML={{ __html: emailsHtml }} />
        </div>
      </div>
    </div>
  )
}
