import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModal } from '../context/ModalContext'
import { usePhase1 } from '../context/Phase1Context'
import { api } from '../lib/api'
import { QK } from '../lib/queryKeys'
import { notify } from '../lib/notify'

export default function Perfiles() {
  const { state } = usePhase1()
  const { openModal } = useModal()
  const qc = useQueryClient()
  const [personaId, setPersonaId] = useState('')
  const [selectedIds, setSelectedIds] = useState([])

  const persona = useMemo(() => state.personal.find((p) => String(p.id) === personaId), [state.personal, personaId])

  const onPersonaChange = (idStr) => {
    setPersonaId(idStr)
    const p = state.personal.find((x) => String(x.id) === idStr)
    setSelectedIds(p ? [...(p.tareas || [])] : [])
  }

  const toggleTarea = (tid) => {
    setSelectedIds((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]))
  }

  const saveAsign = useMutation({
    mutationFn: () => api.put(`personal/${personaId}/tareas/`, { tareas: selectedIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal'] })
      notify('Asignación guardada')
    },
    onError: () => notify('No se pudo guardar'),
  })

  const delTarea = useMutation({
    mutationFn: (id) => api.delete(`tareas/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.tareas })
      qc.invalidateQueries({ queryKey: ['personal'] })
      notify('Tarea eliminada')
    },
    onError: () => notify('No se pudo eliminar'),
  })

  return (
    <div className="page active" id="page-perfil">
      <div className="section-header">
        <div>
          <h2>Perfiles &amp; Tareas</h2>
          <p>Gestión de tareas y asignación por persona</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => openModal('modal-tarea')}>
          + Nueva tarea
        </button>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <span className="dot" />
            Tareas disponibles
          </div>
          <div id="lista-tareas-global">
            {state.tareas.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '20px 0', textAlign: 'center' }}>No hay tareas definidas</div>
            ) : (
              state.tareas.map((t) => (
                <div key={t.id} className="task-list-item">
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--text)' }}>{t.nombre}</div>
                    {t.desc ? <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{t.desc}</div> : null}
                  </div>
                  <button type="button" className="btn btn-danger btn-xs" onClick={() => delTarea.mutate(t.id)} disabled={delTarea.isPending}>
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent2)' }} />
            Asignar tareas a persona
          </div>
          <div className="form-row">
            <label>Seleccionar persona</label>
            <select id="asign-persona" value={personaId} onChange={(e) => onPersonaChange(e.target.value)}>
              <option value="">-- selecciona --</option>
              {state.personal.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div id="asign-tareas-list">
            {!persona ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Selecciona una persona para ver sus tareas asignadas.</div>
            ) : (
              state.tareas.map((t) => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleTarea(t.id)} />
                  <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{t.nombre}</span>
                </label>
              ))
            )}
          </div>
          <div id="asign-footer" style={{ display: persona ? 'block' : 'none', marginTop: '16px' }}>
            <button type="button" className="btn btn-primary" disabled={saveAsign.isPending} onClick={() => saveAsign.mutate()}>
              💾 Guardar asignación
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
