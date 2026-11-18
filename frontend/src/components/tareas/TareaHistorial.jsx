import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatFechaHora } from '../../lib/format'
import { notifyError } from '../../lib/notify'
import { QK } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'

/** Comentarios y cambios de una tarea. Comenta cualquiera que la ve (aunque no pueda editarla). */
export default function TareaHistorial({ tareaId, esAdmin }) {
  const qc = useQueryClient()
  const [texto, setTexto] = useState('')
  const [verCambios, setVerCambios] = useState(false)
  const q = useQuery({ queryKey: QK.tareaHistorial(tareaId), queryFn: () => api.get(`tareas/${tareaId}/historial/`).then((r) => r.data) })
  const refrescar = () => qc.invalidateQueries({ queryKey: QK.tareaHistorial(tareaId) })

  const comentar = useMutation({
    mutationFn: () => api.post(`tareas/${tareaId}/comentarios/`, { texto: texto.trim() }),
    onSuccess: () => {
      setTexto('')
      refrescar()
    },
    onError: (e) => notifyError(e, 'No se pudo comentar'),
  })
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`tareas/${tareaId}/comentarios/${id}/`),
    onSuccess: refrescar,
    onError: (e) => notifyError(e),
  })

  const items = q.data ?? []
  const cambios = items.filter((i) => i.tipo === 'cambio').length
  const visibles = verCambios ? items : items.filter((i) => i.tipo === 'comentario')
  const enviar = () => texto.trim() && !comentar.isPending && comentar.mutate()

  return (
    <div className="tarea-historial">
      <div className="tarea-historial-head">
        <div className="tarea-sheet-label">Comentarios</div>
        {cambios ? (
          <button type="button" className="link-btn small" onClick={() => setVerCambios((v) => !v)}>
            {verCambios ? 'Ocultar cambios' : `Ver historial de cambios (${cambios})`}
          </button>
        ) : null}
      </div>
      {q.isLoading ? <div className="muted small">Cargando…</div> : null}
      {!q.isLoading && !visibles.length ? <div className="muted small">Todavía no hay comentarios.</div> : null}
      <ul className="tarea-historial-lista">
        {visibles.map((i) => (
          <li key={`${i.tipo}-${i.id}`} className={`tarea-historial-item tarea-historial-item--${i.tipo}`}>
            <div className="tarea-historial-meta">
              <strong>{i.autor}</strong> · {formatFechaHora(i.creado)}
              {i.tipo === 'comentario' && (i.propio || esAdmin) ? (
                <button
                  type="button"
                  className="link-btn down small"
                  onClick={async () => (await confirmar({ mensaje: '¿Borrar este comentario?', peligro: true, confirmar: 'Borrar' })) && borrar.mutate(i.id)}
                >
                  Borrar
                </button>
              ) : null}
            </div>
            <div className={i.tipo === 'comentario' ? 'pre-wrap' : 'muted small'}>{i.texto}</div>
          </li>
        ))}
      </ul>
      <div className="tarea-comentar">
        <textarea
          rows={2}
          value={texto}
          maxLength={4000}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              enviar()
            }
          }}
          placeholder="Escribí un comentario (avisa a los responsables). Cmd+Enter para enviar."
          aria-label="Nuevo comentario"
        />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!texto.trim() || comentar.isPending} onClick={enviar}>
          Comentar
        </button>
      </div>
    </div>
  )
}
