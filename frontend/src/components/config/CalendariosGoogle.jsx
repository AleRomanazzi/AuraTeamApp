import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QueryState from '../ui/QueryState'
import Tag from '../ui/Tag'
import { api } from '../../lib/api'
import { COLORES_GOOGLE, ETIQUETAS, labelDe } from '../../lib/constants'
import { formatFechaHora } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { QK, invalidar } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'

const hexDe = (colorId) => COLORES_GOOGLE.find((c) => c.value === colorId)?.hex

function resumenSync(r) {
  if (r.omitida) return r.detail || 'No había nada nuevo para sincronizar'
  const partes = [
    r.enviados && `${r.enviados} eventos subidos a Google`,
    r.tareas && `${r.tareas} tareas actualizadas`,
    r.creados && `${r.creados} traídos de Google`,
    r.actualizados && `${r.actualizados} actualizados`,
    r.borrados && `${r.borrados} borrados`,
  ].filter(Boolean)
  return partes.length ? `Sincronizado: ${partes.join(' · ')}` : 'Todo al día: no hubo cambios'
}

function Pintar() {
  const qc = useQueryClient()
  const [sugeridos, setSugeridos] = useState(null)
  const [elegidos, setElegidos] = useState(new Set())
  const clave = (s) => `${s.calendar_id}|${s.event_id}`

  const buscar = useMutation({
    mutationFn: () => api.get('calendario/google/colores/').then((r) => r.data),
    onSuccess: (lista) => {
      setSugeridos(lista)
      setElegidos(new Set(lista.map(clave)))
    },
    onError: (e) => notifyError(e, 'No se pudieron leer los eventos de Google'),
  })
  const pintar = useMutation({
    mutationFn: () => api.post('calendario/google/colores/', { eventos: sugeridos.filter((s) => elegidos.has(clave(s))) }).then((r) => r.data),
    onSuccess: (r) => {
      notify(`${r.pintados} eventos pintados en Google`)
      setSugeridos(null)
      invalidar(qc, ['google-calendar', 'cal-google'])
    },
    onError: (e) => notifyError(e, 'No se pudieron pintar los eventos'),
  })
  const alternar = (k) =>
    setElegidos((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  return (
    <div style={{ marginTop: 18 }}>
      <div className="card-title">
        <span className="dot" style={{ background: 'var(--gold)' }} /> Pintar eventos existentes
      </div>
      <p className="small muted">
        Busca los eventos de hoy en adelante que no tienen color y cuyo título nombra a un cliente (por su nombre o sus palabras clave). Los repetitivos se pintan como serie completa.
      </p>
      {sugeridos === null ? (
        <button type="button" className="btn btn-secondary btn-sm" disabled={buscar.isPending} onClick={() => buscar.mutate()}>
          {buscar.isPending ? 'Buscando…' : 'Buscar eventos para pintar'}
        </button>
      ) : sugeridos.length === 0 ? (
        <div className="empty">No hay eventos sin color que nombren a un cliente.</div>
      ) : (
        <>
          <div className="pintar-lista">
            {sugeridos.map((s) => (
              <label key={clave(s)} className="check-row pintar-fila">
                <input type="checkbox" checked={elegidos.has(clave(s))} onChange={() => alternar(clave(s))} />
                <i className="cat-dot" style={{ background: hexDe(s.color_id) }} />
                <span className="pintar-titulo">{s.titulo}</span>
                <span className="muted small nowrap">
                  {s.cliente_nombre} · {labelDe(ETIQUETAS, s.etiqueta)}
                  {s.repetitivo ? ' · se repite' : ` · ${formatFechaHora(s.inicio)}`}
                </span>
              </label>
            ))}
          </div>
          <div className="header-actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pintar.isPending || elegidos.size === 0}
              onClick={async () =>
                (await confirmar({ mensaje: `Se va a cambiar el color de ${elegidos.size} eventos en el Google Calendar de la agencia.`, confirmar: 'Pintar' })) && pintar.mutate()
              }
            >
              {pintar.isPending ? 'Pintando…' : `Pintar ${elegidos.size} eventos`}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSugeridos(null)}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Etiquetas (calendarios) de Google Calendar de la agencia; solo admin y con la cuenta conectada. */
export default function CalendariosGoogle() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK.googleCalendarios, queryFn: () => api.get('calendario/google/').then((r) => r.data) })
  const sincronizar = useMutation({
    mutationFn: () => api.post('calendario/google/sincronizar/', { completa: true }).then((r) => r.data),
    onSuccess: (r) => {
      invalidar(qc, ['cal-google', 'cal-eventos', 'google-calendar', 'mi-panel', 'tareas'])
      notify(resumenSync(r))
    },
    onError: (e) => notifyError(e, 'No se pudo sincronizar con Google Calendar'),
  })
  const elegir = useMutation({
    mutationFn: (body) => api.post('calendario/google/etiqueta/', body),
    onSuccess: () => {
      invalidar(qc, ['cal-google'])
      notify('Etiqueta actualizada')
    },
    onError: (e) => notifyError(e),
  })
  if (q.isSuccess && !q.data.conectado) return null

  return (
    <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
      <div className="card-title">
        <span className="dot" style={{ background: 'var(--accent2)' }} /> Google Calendar · etiquetas
      </div>
      <QueryState query={q}>
        {(e) => (
          <>
            <p className="small muted">
              Cada evento del panel se guarda en el calendario de su etiqueta, con el color de su cliente; las tareas con fecha van como día completo al calendario que tengan elegido (Historias, Posteos o Edición). Lo que se carga
              directo en estos calendarios aparece en el panel, con el cliente reconocido por el color o por el título.
            </p>
            <div>
              {e.etiquetas.map((et) => (
                <div key={et.etiqueta} className="vinculo-row">
                  <span>
                    {et.nombre} {et.privada ? <Tag>solo socios</Tag> : null}
                  </span>
                  <select
                    aria-label={`Calendario de ${et.nombre}`}
                    value={et.calendar_id || ''}
                    disabled={elegir.isPending || !e.calendarios.length}
                    onChange={(ev) => ev.target.value && elegir.mutate({ etiqueta: et.etiqueta, calendar_id: ev.target.value })}
                  >
                    <option value="">— Sin elegir —</option>
                    {e.calendarios.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="small muted">
              Última sincronización: {e.ultima_sync ? formatFechaHora(e.ultima_sync) : 'nunca'}
              {e.ultima_sync_completa ? ` · completa: ${formatFechaHora(e.ultima_sync_completa)}` : ''} · {e.eventos_en_google} eventos vinculados
            </p>
            {e.ultimo_error ? (
              <div className="info-box down" style={{ marginBottom: 12 }}>
                Último error{e.ultimo_error_en ? ` (${formatFechaHora(e.ultimo_error_en)})` : ''}: {e.ultimo_error}
              </div>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm" disabled={sincronizar.isPending} onClick={() => sincronizar.mutate()}>
              {sincronizar.isPending ? 'Sincronizando…' : '⟳ Sincronizar todo'}
            </button>
            <Pintar />
          </>
        )}
      </QueryState>
    </div>
  )
}
