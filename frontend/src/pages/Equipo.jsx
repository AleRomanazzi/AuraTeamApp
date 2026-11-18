import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import AsignacionForm from '../components/equipo/AsignacionForm'
import UsuarioForm from '../components/equipo/UsuarioForm'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import Tag from '../components/ui/Tag'
import { usePersonas } from '../hooks/useData'
import { api } from '../lib/api'
import { COLORES, ROLES_EQUIPO, TIPOS_VINCULO, labelDe } from '../lib/constants'
import { TIPOS_CONTACTO, contactosAObjeto, linkContacto, objetoAContactos } from '../lib/contactos'
import { iniciales } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { confirmar } from '../store/confirmStore'

const ACCESO_VACIO = { dar: false, username: '', email: '', password: '', rol: 'equipo', roles: [] }

function PersonaForm({ inicial, onClose }) {
  const qc = useQueryClient()
  const nueva = !inicial?.id
  // Al crear, la persona puede salir ya con acceso al panel (usuario vinculado): un solo alta.
  const [acceso, setAcceso] = useState(ACCESO_VACIO)
  const setA = (k) => (e) => setAcceso((s) => ({ ...s, [k]: e.target.value }))
  const toggleRol = (r) => setAcceso((s) => ({ ...s, roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : [...s.roles, r] }))
  const [f, setF] = useState(() => ({
    nombre: inicial?.nombre ?? '',
    rol: inicial?.rol ?? '',
    color: inicial?.color ?? COLORES[1],
    tipo_vinculo: inicial?.tipo_vinculo ?? 'freelancer',
    cuit: inicial?.cuit ?? '',
    alias_cbu: inicial?.alias_cbu ?? '',
    activo: inicial?.activo ?? true,
    notas: inicial?.notas ?? '',
    ...contactosAObjeto(inicial?.contactos),
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))

  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        nombre: f.nombre,
        rol: f.rol,
        color: f.color,
        tipo_vinculo: f.tipo_vinculo,
        cuit: f.cuit,
        alias_cbu: f.alias_cbu,
        activo: f.activo,
        notas: f.notas,
        contactos: objetoAContactos(f),
      }
      if (!nueva) return api.put(`personal/${inicial.id}/`, body)
      return api.post('personal/', body).then(async (r) => {
        if (!acceso.dar) return r
        const { username, email, password, rol, roles } = acceso
        try {
          await api.post('usuarios/', { username, email, password, rol, roles, first_name: f.nombre, persona: r.data.id, is_active: true })
        } catch (e) {
          e.personaCreada = true
          throw e
        }
        return r
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal'] })
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      notify(inicial?.id ? 'Persona actualizada' : acceso.dar ? 'Persona agregada con acceso al panel' : 'Persona agregada')
      onClose()
    },
    onError: (e) => {
      if (e.personaCreada) {
        qc.invalidateQueries({ queryKey: ['personal'] })
        notifyError(e, 'La persona se creó, pero no el acceso al panel (podés dárselo desde su tarjeta)')
        onClose()
        return
      }
      notifyError(e, 'No se pudo guardar')
    },
  })

  return (
    <Modal
      title={inicial?.id ? `Editar ${inicial.nombre}` : 'Nueva persona'}
      onClose={onClose}
      size="lg"
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
        <Field label="Nombre">
          <input value={f.nombre} onChange={set('nombre')} required maxLength={120} />
        </Field>
        <Field label="Puesto" hint="Descriptivo. Lo que ve en el panel depende de sus roles de acceso.">
          <input value={f.rol} onChange={set('rol')} maxLength={120} placeholder="Diseñadora, CM, editor…" />
        </Field>
      </div>
      <div className="grid-3 tight">
        <Field label="Vínculo">
          <select value={f.tipo_vinculo} onChange={set('tipo_vinculo')}>
            {TIPOS_VINCULO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="CUIT / CUIL">
          <input value={f.cuit} onChange={set('cuit')} maxLength={20} />
        </Field>
        <Field label="Alias / CBU">
          <input value={f.alias_cbu} onChange={set('alias_cbu')} maxLength={60} />
        </Field>
      </div>
      <div className="grid-3 tight">
        {TIPOS_CONTACTO.map((t) => (
          <Field key={t.tipo} label={t.label}>
            <input value={f[t.tipo]} onChange={set(t.tipo)} type={t.tipo === 'email' ? 'email' : 'text'} />
          </Field>
        ))}
      </div>
      <Field label="Color">
        <div className="color-picker">
          {COLORES.map((c) => (
            <button key={c} type="button" className={`color-swatch${f.color === c ? ' active' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setF((s) => ({ ...s, color: c }))} />
          ))}
        </div>
      </Field>
      <Field label="Notas">
        <textarea rows={2} value={f.notas} onChange={set('notas')} />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={f.activo} onChange={(e) => setF((s) => ({ ...s, activo: e.target.checked }))} /> Activa
      </label>
      {nueva ? (
        <div className="acceso-box">
          <label className="check-row">
            <input type="checkbox" checked={acceso.dar} onChange={(e) => setAcceso((s) => ({ ...s, dar: e.target.checked }))} /> Darle acceso al panel
          </label>
          {acceso.dar ? (
            <>
              <div className="grid-3 tight">
                <Field label="Usuario">
                  <input value={acceso.username} onChange={setA('username')} required autoComplete="off" />
                </Field>
                <Field label="Email" hint="Para avisos y recuperar acceso.">
                  <input type="email" value={acceso.email} onChange={setA('email')} />
                </Field>
                <Field label="Contraseña">
                  <input type="password" autoComplete="new-password" value={acceso.password} onChange={setA('password')} required minLength={8} />
                </Field>
              </div>
              <Field label="Acceso">
                <select value={acceso.rol} onChange={setA('rol')}>
                  <option value="equipo">Equipo</option>
                  <option value="admin">Administrador (ve y administra todo)</option>
                </select>
              </Field>
              {acceso.rol === 'equipo' ? (
                <Field label="Roles" hint="Lo que suma cada rol se define en Configuración → Permisos.">
                  <div className="chip-select">
                    {ROLES_EQUIPO.map((r) => (
                      <button key={r.value} type="button" className={`chip${acceso.roles.includes(r.value) ? ' active' : ''}`} onClick={() => toggleRol(r.value)} aria-pressed={acceso.roles.includes(r.value)}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </Field>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

export default function Equipo() {
  const qc = useQueryClient()
  const q = usePersonas()
  const [editando, setEditando] = useState(null)
  const [asignando, setAsignando] = useState(null)
  const [dandoAcceso, setDandoAcceso] = useState(null)
  const [verInactivos, setVerInactivos] = useState(false)

  const borrar = useMutation({
    mutationFn: (id) => api.delete(`personal/${id}/`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['personal'] })
      notify(r.status === 200 ? 'Tenía pagos registrados: quedó desactivada' : 'Persona eliminada')
    },
    onError: (e) => notifyError(e),
  })

  const lista = (q.data ?? []).filter((p) => verInactivos || p.activo)

  return (
    <>
      <PageHeader titulo="Equipo" subtitulo="Personas y cuentas en las que trabajan">
        <label className="check-row">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos
        </label>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
          + Nueva persona
        </button>
      </PageHeader>
      <QueryState query={q} vacio="Todavía no hay personas en el equipo." esVacio={() => lista.length === 0}>
        <div className="staff-grid">
          {lista.map((p) => {
            const contactos = contactosAObjeto(p.contactos)
            return (
              <div key={p.id} className={`staff-card${p.activo ? '' : ' row-muted'}`}>
                <div className="staff-top">
                  <div className="staff-avatar" style={{ background: `${p.color}22`, color: p.color }}>
                    {iniciales(p.nombre)}
                  </div>
                  <div>
                    <div className="staff-name">{p.nombre}</div>
                    <div className="staff-role">
                      {p.rol || 'Sin puesto'} · {labelDe(TIPOS_VINCULO, p.tipo_vinculo)}
                    </div>
                  </div>
                  {!p.activo ? <Tag>Inactiva</Tag> : null}
                </div>
                {p.alias_cbu ? <div className="small muted mono">Alias: {p.alias_cbu}</div> : null}
                <div className="staff-acceso small">
                  {p.usuario ? (
                    <>
                      <span className={p.usuario.is_active ? '' : 'down'}>
                        Acceso: {p.usuario.username}
                        {p.usuario.is_active ? '' : ' (desactivado)'}
                      </span>
                      {p.usuario.rol === 'admin' ? (
                        <Tag color="purple">Admin</Tag>
                      ) : (
                        p.usuario.roles.map((r) => <Tag key={r}>{labelDe(ROLES_EQUIPO, r)}</Tag>)
                      )}
                    </>
                  ) : (
                    <span className="muted">Sin acceso al panel</span>
                  )}
                </div>
                <div className="staff-section">
                  <div className="staff-section-title">Cuentas</div>
                  {p.clientes.length ? (
                    p.clientes.map((c) => (
                      <span key={c.id} className="task-chip">
                        {c.cliente_nombre}
                        {c.rol ? ` · ${c.rol}` : ''}
                      </span>
                    ))
                  ) : (
                    <span className="muted small">Sin cuentas asignadas</span>
                  )}
                </div>
                <div className="staff-contacts">
                  {TIPOS_CONTACTO.filter((t) => contactos[t.tipo]).map((t) => {
                    const href = linkContacto(t.tipo, contactos[t.tipo])
                    return href ? (
                      <a key={t.tipo} className="contact-link" href={href} target="_blank" rel="noreferrer">
                        {t.label}
                      </a>
                    ) : (
                      <span key={t.tipo} className="contact-link">
                        {contactos[t.tipo]}
                      </span>
                    )
                  })}
                </div>
                <div className="staff-actions-row">
                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => setAsignando(p)}>
                    + Asignar cuenta
                  </button>
                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(p)}>
                    Editar
                  </button>
                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => setDandoAcceso(p)}>
                    {p.usuario ? 'Acceso' : 'Dar acceso'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-xs"
                    aria-label={`Eliminar a ${p.nombre}`}
                    onClick={async () =>
                      (await confirmar({
                        titulo: `Eliminar a ${p.nombre}`,
                        mensaje: 'Si tiene pagos registrados se desactiva en lugar de borrarse, para conservar el historial.',
                        peligro: true,
                        confirmar: 'Eliminar',
                      })) && borrar.mutate(p.id)
                    }
                  >
                    🗑
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </QueryState>
      {editando ? <PersonaForm inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
      {dandoAcceso ? <UsuarioForm inicial={dandoAcceso.usuario} personaFija={dandoAcceso} onClose={() => setDandoAcceso(null)} /> : null}
      {asignando ? <AsignacionForm personaId={asignando.id} onClose={() => setAsignando(null)} /> : null}
    </>
  )
}
