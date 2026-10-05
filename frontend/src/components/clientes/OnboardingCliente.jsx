import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePersonas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { ROLES_ONBOARDING } from '../../lib/constants'
import { formatFechaCorta } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { QK, TAREAS, invalidar } from '../../lib/queryKeys'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import ProgressBar from '../ui/ProgressBar'
import Tag from '../ui/Tag'

function IniciarModal({ clienteId, sugeridos, onClose }) {
  const qc = useQueryClient()
  const { data: personas = [] } = usePersonas()
  const [resp, setResp] = useState(() => ({ ...sugeridos }))
  const iniciar = useMutation({
    mutationFn: () => api.post(`clientes/${clienteId}/onboarding/`, { responsables: resp }),
    onSuccess: () => {
      invalidar(qc, [...TAREAS, 'clientes'])
      notify('Onboarding iniciado: las tareas ya están asignadas')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo iniciar el onboarding'),
  })
  return (
    <Modal
      title="Iniciar onboarding"
      onClose={onClose}
      onSubmit={() => iniciar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={iniciar.isPending}>
            Crear tareas
          </button>
        </>
      }
    >
      <p className="muted small">Cada paso de la plantilla se asigna a la persona elegida para su rol. Los vacíos quedan sin responsable.</p>
      {ROLES_ONBOARDING.map((r) => (
        <Field key={r.value} label={r.label}>
          <select value={resp[r.value] ?? ''} onChange={(e) => setResp((s) => ({ ...s, [r.value]: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">Sin responsable</option>
            {personas
              .filter((p) => p.activo)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
          </select>
        </Field>
      ))}
    </Modal>
  )
}

export default function OnboardingCliente({ clienteId, esAdmin }) {
  const qc = useQueryClient()
  const [iniciando, setIniciando] = useState(false)
  const q = useQuery({ queryKey: QK.clienteOnboarding(clienteId), queryFn: () => api.get(`clientes/${clienteId}/onboarding/`).then((r) => r.data) })
  const drive = useMutation({
    mutationFn: () => api.post(`clientes/${clienteId}/drive/`).then((r) => r.data),
    onSuccess: () => {
      invalidar(qc, [...TAREAS, 'clientes'])
      notify('Carpeta de Drive creada')
    },
    onError: (e) => notifyError(e, 'No se pudo crear la carpeta'),
  })
  const marcar = useMutation({
    mutationFn: ({ id, estado }) => api.patch(`tareas/${id}/`, { estado }),
    onSuccess: () => invalidar(qc, [...TAREAS, 'clientes']),
    onError: (e) => notifyError(e),
  })

  const d = q.data
  if (!d || (!d.total && !esAdmin)) return null
  const pct = d.total ? Math.round((d.hechas * 100) / d.total) : 0

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" style={{ background: d.vencidas ? 'var(--accent3)' : 'var(--success)' }} /> Onboarding
          {d.total ? (
            <span className="muted small">
              {' '}
              · {d.hechas}/{d.total} pasos
            </span>
          ) : null}
          {d.vencidas ? <Tag color="red">{d.vencidas} atrasado{d.vencidas === 1 ? '' : 's'}</Tag> : null}
        </div>
        <div className="header-actions">
          {d.drive_url ? (
            <a href={d.drive_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              📁 Carpeta de Drive
            </a>
          ) : esAdmin ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={drive.isPending} onClick={() => drive.mutate()}>
              {drive.isPending ? 'Creando…' : '📁 Crear carpeta de Drive'}
            </button>
          ) : null}
          {!d.total && esAdmin ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setIniciando(true)}>
              Iniciar onboarding
            </button>
          ) : null}
        </div>
      </div>
      {d.total ? (
        <>
          <ProgressBar valor={pct} color={d.vencidas ? 'var(--gold)' : 'var(--success)'} etiqueta="Progreso del onboarding" />
          <div style={{ marginTop: 10 }}>
            {d.tareas.map((t) => (
              <div key={t.id} className={`list-row${t.estado === 'hecha' ? ' row-muted' : ''}`}>
                <input
                  type="checkbox"
                  checked={t.estado === 'hecha'}
                  disabled={!t.puede_editar || marcar.isPending}
                  onChange={(e) => marcar.mutate({ id: t.id, estado: e.target.checked ? 'hecha' : 'pendiente' })}
                  aria-label={`Marcar ${t.titulo}`}
                />
                <div className="list-row-main">
                  <Link to={`/tareas?tarea=${t.id}`} className="list-row-title">
                    {t.titulo}
                  </Link>
                  <div className="list-row-sub">{t.asignados_nombres.length ? `👤 ${t.asignados_nombres.join(', ')}` : 'Sin responsable'}</div>
                </div>
                <div className={`list-row-side small${t.vencida ? ' down' : ''}`}>{t.fecha_limite ? formatFechaCorta(t.fecha_limite) : ''}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="muted small">Este cliente no tiene onboarding. Al iniciarlo se crean las tareas de la plantilla (Configuración → Onboarding).</p>
      )}
      {iniciando ? <IniciarModal clienteId={clienteId} sugeridos={d.sugeridos ?? {}} onClose={() => setIniciando(false)} /> : null}
    </div>
  )
}
