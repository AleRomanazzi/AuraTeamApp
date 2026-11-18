import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import { usePersonas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { ROLES_EQUIPO } from '../../lib/constants'
import { notify, notifyError } from '../../lib/notify'
import { QK } from '../../lib/queryKeys'

/** Acceso al panel de una persona del equipo. Con `personaFija` (desde Equipo) no se elige la persona. */
export default function UsuarioForm({ inicial, personaFija, onClose }) {
  const qc = useQueryClient()
  const { data: personas = [] } = usePersonas()
  const [f, setF] = useState(() => ({
    username: inicial?.username ?? '',
    first_name: inicial?.first_name ?? personaFija?.nombre ?? '',
    last_name: inicial?.last_name ?? '',
    email: inicial?.email ?? '',
    rol: inicial?.rol ?? 'equipo',
    roles: inicial?.roles ?? [],
    persona: inicial?.persona ?? personaFija?.id ?? '',
    is_active: inicial?.is_active ?? true,
    password: '',
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const toggleRol = (r) => setF((s) => ({ ...s, roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : [...s.roles, r] }))
  const guardar = useMutation({
    mutationFn: () => {
      const body = { ...f, persona: f.persona || null }
      if (!body.password) delete body.password
      return inicial?.id ? api.put(`usuarios/${inicial.id}/`, body) : api.post('usuarios/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.usuarios })
      qc.invalidateQueries({ queryKey: QK.personal })
      notify('Acceso guardado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar el usuario'),
  })
  return (
    <Modal
      title={personaFija ? `Acceso al panel · ${personaFija.nombre}` : inicial?.id ? `Editar ${inicial.username}` : 'Nuevo usuario'}
      onClose={onClose}
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
            Guardar
          </button>
        </>
      }
    >
      <div className="grid-2 tight">
        <Field label="Usuario">
          <input value={f.username} onChange={set('username')} required autoComplete="off" />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} />
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Nombre">
          <input value={f.first_name} onChange={set('first_name')} />
        </Field>
        <Field label="Apellido">
          <input value={f.last_name} onChange={set('last_name')} />
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Acceso" hint={f.rol === 'admin' ? 'Ve y administra todo: finanzas, clientes, equipo y configuración.' : 'Mi panel, tareas, calendario, sus pagos y lo que sume cada rol.'}>
          <select value={f.rol} onChange={set('rol')}>
            <option value="equipo">Equipo</option>
            <option value="admin">Administrador</option>
          </select>
        </Field>
        {personaFija ? null : (
          <Field label="Persona del equipo" hint="Necesario para que vea sus tareas y pagos">
            <select value={f.persona ?? ''} onChange={set('persona')}>
              <option value="">— Sin vincular —</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {f.rol === 'equipo' ? (
        <Field label="Roles" hint="Podés combinar varios (por ejemplo Fotografía + Diseño). Lo que suma cada rol se define en Configuración → Permisos.">
          <div className="chip-select">
            {ROLES_EQUIPO.map((r) => (
              <button key={r.value} type="button" className={`chip${f.roles.includes(r.value) ? ' active' : ''}`} onClick={() => toggleRol(r.value)} aria-pressed={f.roles.includes(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      <Field label={inicial?.id ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña'}>
        <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required={!inicial?.id} minLength={8} />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => setF((s) => ({ ...s, is_active: e.target.checked }))} /> Activo
      </label>
    </Modal>
  )
}
