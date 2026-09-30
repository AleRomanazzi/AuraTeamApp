import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QueryState from '../ui/QueryState'
import Tag from '../ui/Tag'
import { usePersonas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { formatFechaHora } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { QK, invalidar } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'

function resumenSync(r) {
  if (r.omitida) return 'No había nada nuevo para sincronizar'
  const partes = [
    r.creadas && `${r.creadas} traídas de Notion`,
    r.actualizadas && `${r.actualizadas} actualizadas`,
    r.vinculadas && `${r.vinculadas} vinculadas por título`,
    r.enviadas && `${r.enviadas} enviadas a Notion`,
    r.borradas && `${r.borradas} borradas`,
  ].filter(Boolean)
  return partes.length ? `Sincronizado: ${partes.join(' · ')}` : 'Todo al día: no hubo cambios'
}

function Personas({ configurado }) {
  const qc = useQueryClient()
  const { data: personas = [] } = usePersonas()
  const usuarios = useQuery({ queryKey: QK.notionUsuarios, queryFn: () => api.get('notion/usuarios/').then((r) => r.data), enabled: configurado, staleTime: 5 * 60_000 })
  const guardar = useMutation({
    mutationFn: ({ id, notion_user_id }) => api.patch(`personal/${id}/`, { notion_user_id }),
    onSuccess: () => {
      invalidar(qc, ['personal', 'notion'])
      notify('Vínculo guardado')
    },
    onError: (e) => notifyError(e),
  })
  return (
    <div className="card">
      <div className="card-title">
        <span className="dot" style={{ background: 'var(--accent2)' }} /> Responsables: persona del panel ↔ usuario de Notion
      </div>
      <p className="small muted">Así la columna «Responsable» de Notion y los responsables de cada tarea del panel quedan iguales. Las personas sin vincular no se tocan al sincronizar.</p>
      <QueryState query={usuarios}>
        {(lista) => (
          <div className="table-responsive">
            <table>
              <tbody>
                {personas
                  .filter((p) => p.activo)
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.nombre}</td>
                      <td>
                        <select
                          aria-label={`Usuario de Notion de ${p.nombre}`}
                          value={p.notion_user_id || ''}
                          disabled={guardar.isPending}
                          onChange={(e) => guardar.mutate({ id: p.id, notion_user_id: e.target.value })}
                        >
                          <option value="">— Sin vincular —</option>
                          {lista.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.nombre}
                              {u.email ? ` (${u.email})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  )
}

export default function NotionConfig() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK.notionEstado, queryFn: () => api.get('notion/').then((r) => r.data) })
  const sincronizar = useMutation({
    mutationFn: () => api.post('notion/sincronizar/', { completa: true }).then((r) => r.data),
    onSuccess: (r) => {
      invalidar(qc, ['tareas', 'notion', 'personal', 'clientes', 'dashboard', 'mi-panel'])
      notify(resumenSync(r))
      const c = r.clientes
      if (c && (c.solo_en_notion.length || c.solo_en_panel.length)) {
        notify(`Clientes sin par: ${[...c.solo_en_notion.map((n) => `${n} (solo Notion)`), ...c.solo_en_panel.map((n) => `${n} (solo panel)`)].join(', ')}`, 'error')
      }
    },
    onError: (e) => notifyError(e, 'No se pudo sincronizar con Notion'),
  })
  const reiniciar = useMutation({
    mutationFn: () => api.post('notion/webhook/reiniciar/'),
    onSuccess: () => invalidar(qc, ['notion']),
    onError: (e) => notifyError(e),
  })

  return (
    <QueryState query={q}>
      {(e) => (
        <div className="grid-2">
          <div className="card">
            <div className="card-title">
              <span className="dot" /> Notion · Tareas
            </div>
            <p className="small">
              Estado: {e.configurado ? <Tag color="green">Conectado</Tag> : <Tag>Sin configurar</Tag>}
              {e.configurado ? (
                <span className="muted">
                  {' '}
                  · {e.tareas_vinculadas} tareas, {e.clientes_vinculados} clientes y {e.personas_vinculadas} personas vinculadas
                </span>
              ) : null}
            </p>
            {!e.configurado ? (
              <div className="info-box">Falta la variable NOTION_TOKEN en el servidor (el secreto de la integración interna de Notion).</div>
            ) : (
              <>
                <p className="small muted">
                  Las tareas se sincronizan solas en los dos sentidos. «Sincronizar todo» además vincula clientes y personas por nombre, trae lo que falte y sube a Notion las tareas del panel que no estén allá.
                </p>
                <p className="small muted">
                  Última sincronización: {e.ultima_sync ? formatFechaHora(e.ultima_sync) : 'nunca'}
                  {e.ultima_sync_completa ? ` · completa: ${formatFechaHora(e.ultima_sync_completa)}` : ''}
                </p>
                {e.ultimo_error ? (
                  <div className="info-box down" style={{ marginBottom: 12 }}>
                    Último error ({formatFechaHora(e.ultimo_error_en)}): {e.ultimo_error}
                  </div>
                ) : null}
                <div className="header-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={sincronizar.isPending} onClick={() => sincronizar.mutate()}>
                    {sincronizar.isPending ? 'Sincronizando…' : '⟳ Sincronizar todo'}
                  </button>
                  <a className="btn btn-secondary btn-sm" href={e.tareas_url} target="_blank" rel="noreferrer">
                    Abrir Tareas en Notion
                  </a>
                </div>
              </>
            )}
          </div>
          {e.configurado ? (
            <div className="card">
              <div className="card-title">
                <span className="dot" style={{ background: 'var(--gold)' }} /> Cambios en tiempo real (webhook)
              </div>
              <p className="small muted">Para que lo que se edita en Notion llegue al panel en segundos. Se configura una sola vez en la integración de Notion, pestaña «Webhooks».</p>
              <div className="data-list small">
                <div>
                  <span className="muted">URL</span>
                  <code>{e.webhook_url}</code>
                </div>
                <div>
                  <span className="muted">Token de verificación</span>
                  {e.webhook_token ? <code>{e.webhook_token}</code> : <span className="muted">Todavía no llegó: creá la suscripción en Notion y recargá esta página.</span>}
                </div>
              </div>
              {e.webhook_token ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  style={{ marginTop: 10 }}
                  disabled={reiniciar.isPending}
                  onClick={async () => (await confirmar({ mensaje: 'Se borra el token guardado para poder crear una suscripción nueva en Notion.', confirmar: 'Reiniciar' })) && reiniciar.mutate()}
                >
                  Reiniciar webhook
                </button>
              ) : null}
            </div>
          ) : null}
          <Personas configurado={e.configurado} />
        </div>
      )}
    </QueryState>
  )
}
