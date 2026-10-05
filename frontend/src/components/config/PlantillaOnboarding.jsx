import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { opcionesEtiqueta, useEtiquetas } from '../../hooks/useData'
import { api, getList } from '../../lib/api'
import { ROLES_ONBOARDING } from '../../lib/constants'
import { notify, notifyError } from '../../lib/notify'
import { QK } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'
import QueryState from '../ui/QueryState'

const VACIO = { titulo: '', rol: 'cm', dias_desde_alta: 0, etiqueta: 'reuniones' }

function FilaPaso({ paso, etiquetas, onGuardar, onBorrar, onMover, primero, ultimo }) {
  const guardarTexto = (campo) => (e) => {
    const valor = campo === 'dias_desde_alta' ? Number(e.target.value || 0) : e.target.value.trim()
    if (valor !== paso[campo] && (campo !== 'titulo' || valor)) onGuardar({ [campo]: valor })
  }
  return (
    <div className={`onb-paso${paso.activo ? '' : ' row-muted'}`}>
      <div className="onb-orden">
        <button type="button" className="link-btn" aria-label="Subir" disabled={primero} onClick={() => onMover(-1)}>
          ↑
        </button>
        <button type="button" className="link-btn" aria-label="Bajar" disabled={ultimo} onClick={() => onMover(1)}>
          ↓
        </button>
      </div>
      <div className="onb-main">
        <input key={`t${paso.titulo}`} defaultValue={paso.titulo} onBlur={guardarTexto('titulo')} aria-label="Paso" maxLength={160} />
        <input key={`d${paso.descripcion}`} defaultValue={paso.descripcion} onBlur={guardarTexto('descripcion')} aria-label="Detalle" placeholder="Detalle (opcional)" className="small" />
      </div>
      <select value={paso.rol} onChange={(e) => onGuardar({ rol: e.target.value })} aria-label="Responsable">
        {ROLES_ONBOARDING.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <label className="onb-dias">
        <input key={`n${paso.dias_desde_alta}`} type="number" min={0} max={90} defaultValue={paso.dias_desde_alta} onBlur={guardarTexto('dias_desde_alta')} aria-label="Días desde el alta" />
        <span className="muted small">días</span>
      </label>
      <select value={paso.etiqueta} onChange={(e) => onGuardar({ etiqueta: e.target.value })} aria-label="Etiqueta">
        {opcionesEtiqueta(etiquetas, paso.etiqueta).map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </select>
      <label className="check-row small" title={paso.accion === 'drive' ? 'Vincula la carpeta del cliente dentro de CLIENTES (o la crea ahí) y se marca hecha' : undefined}>
        <input type="checkbox" checked={paso.activo} onChange={(e) => onGuardar({ activo: e.target.checked })} /> {paso.accion === 'drive' ? '📁 Activo' : 'Activo'}
      </label>
      <button type="button" className="link-btn down" aria-label={`Eliminar ${paso.titulo}`} onClick={onBorrar}>
        ×
      </button>
    </div>
  )
}

export default function PlantillaOnboarding() {
  const qc = useQueryClient()
  const etiquetas = useEtiquetas()
  const [nuevo, setNuevo] = useState(VACIO)
  const q = useQuery({ queryKey: QK.onboardingPasos, queryFn: () => getList('onboarding-pasos/') })
  const refrescar = () => qc.invalidateQueries({ queryKey: QK.onboardingPasos })

  const crear = useMutation({
    mutationFn: () => api.post('onboarding-pasos/', { ...nuevo, orden: (q.data?.length ?? 0) + 1 }),
    onSuccess: () => {
      setNuevo(VACIO)
      refrescar()
      notify('Paso agregado')
    },
    onError: (e) => notifyError(e, 'No se pudo agregar'),
  })
  const actualizar = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`onboarding-pasos/${id}/`, body),
    onSuccess: refrescar,
    onError: (e) => notifyError(e),
  })
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`onboarding-pasos/${id}/`),
    onSuccess: refrescar,
    onError: (e) => notifyError(e),
  })
  const mover = useMutation({
    mutationFn: (lista) => Promise.all(lista.map((p, i) => (p.orden === i ? null : api.patch(`onboarding-pasos/${p.id}/`, { orden: i })))),
    onSuccess: refrescar,
    onError: (e) => notifyError(e),
  })

  return (
    <div className="card">
      <div className="card-title">
        <span className="dot" /> Plantilla de onboarding de clientes
      </div>
      <p className="muted small">
        Al dar de alta un cliente, cada paso activo se convierte en una tarea para la persona del rol indicado (la asignada a ese cliente o, para socios, quien lo da de alta), con fecha = alta + días. El paso 📁 vincula sola la
        carpeta del cliente en Mi unidad → CLIENTES (si no existe, la crea ahí).
      </p>
      <QueryState query={q} vacio="La plantilla está vacía.">
        {(pasos) => (
          <div className="onb-lista">
            {pasos.map((p, i) => (
              <FilaPaso
                key={p.id}
                paso={p}
                etiquetas={etiquetas}
                primero={i === 0}
                ultimo={i === pasos.length - 1}
                onGuardar={(cambios) => actualizar.mutate({ id: p.id, ...cambios })}
                onMover={(delta) => {
                  const lista = [...pasos]
                  ;[lista[i], lista[i + delta]] = [lista[i + delta], lista[i]]
                  mover.mutate(lista)
                }}
                onBorrar={async () => (await confirmar({ mensaje: `¿Eliminar el paso «${p.titulo}» de la plantilla? Las tareas ya creadas no se tocan.`, peligro: true, confirmar: 'Eliminar' })) && borrar.mutate(p.id)}
              />
            ))}
          </div>
        )}
      </QueryState>
      <form
        className="filters"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          crear.mutate()
        }}
      >
        <input placeholder="Nuevo paso" value={nuevo.titulo} onChange={(e) => setNuevo((s) => ({ ...s, titulo: e.target.value }))} required maxLength={160} aria-label="Nuevo paso" />
        <select value={nuevo.rol} onChange={(e) => setNuevo((s) => ({ ...s, rol: e.target.value }))} aria-label="Responsable">
          {ROLES_ONBOARDING.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <input type="number" min={0} max={90} value={nuevo.dias_desde_alta} onChange={(e) => setNuevo((s) => ({ ...s, dias_desde_alta: e.target.value }))} aria-label="Días desde el alta" style={{ width: 80 }} />
        <select value={nuevo.etiqueta} onChange={(e) => setNuevo((s) => ({ ...s, etiqueta: e.target.value }))} aria-label="Etiqueta">
          {opcionesEtiqueta(etiquetas, nuevo.etiqueta).map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary btn-sm" disabled={crear.isPending}>
          Agregar
        </button>
      </form>
    </div>
  )
}
