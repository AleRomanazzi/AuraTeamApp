import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QueryState from '../ui/QueryState'
import { api } from '../../lib/api'
import { notify, notifyError } from '../../lib/notify'
import { QK } from '../../lib/queryKeys'

function Matriz({ datos }) {
  const qc = useQueryClient()
  const [porRol, setPorRol] = useState(datos.por_rol)
  const cambiado = JSON.stringify(porRol) !== JSON.stringify(datos.por_rol)
  const alternar = (rol, permiso) =>
    setPorRol((s) => {
      const actuales = s[rol] ?? []
      return { ...s, [rol]: actuales.includes(permiso) ? actuales.filter((p) => p !== permiso) : [...actuales, permiso].sort() }
    })
  const guardar = useMutation({
    mutationFn: () => api.put('auth/permisos/', { por_rol: porRol }).then((r) => r.data),
    onSuccess: (d) => {
      qc.setQueryData(QK.permisos, d)
      qc.invalidateQueries({ queryKey: QK.me })
      notify('Permisos guardados')
    },
    onError: (e) => notifyError(e, 'No se pudieron guardar los permisos'),
  })
  return (
    <>
      <div className="table-responsive">
        <table className="permisos-tabla">
          <thead>
            <tr>
              <th>Rol</th>
              {datos.permisos.map((p) => (
                <th key={p.value} className="centro">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {datos.roles.map((r) => (
              <tr key={r.value}>
                <td className="cell-title">{r.label}</td>
                {datos.permisos.map((p) => (
                  <td key={p.value} className="centro">
                    <input type="checkbox" checked={(porRol[r.value] ?? []).includes(p.value)} onChange={() => alternar(r.value, p.value)} aria-label={`${r.label}: ${p.label}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!cambiado || guardar.isPending} onClick={() => setPorRol(datos.por_rol)}>
          Descartar
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!cambiado || guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar
        </button>
      </div>
    </>
  )
}

/** Qué secciones extra suma cada rol del equipo (los administradores ven todo). */
export default function PermisosRoles() {
  const q = useQuery({ queryKey: QK.permisos, queryFn: () => api.get('auth/permisos/').then((r) => r.data) })
  return (
    <div className="card">
      <div className="card-title">
        <span className="dot" /> Permisos por rol
      </div>
      <p className="muted small">
        Todo el equipo tiene Mi panel, Tareas, Calendario, sus pagos y su cuenta. Acá elegís qué suma cada rol; quien tiene varios roles junta los permisos de todos. Los cambios rigen al instante.
      </p>
      <QueryState query={q}>{(d) => <Matriz key={JSON.stringify(d.por_rol)} datos={d} />}</QueryState>
    </div>
  )
}
