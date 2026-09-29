import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import AsignacionForm from '../components/equipo/AsignacionForm'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import Tag from '../components/ui/Tag'
import { usePersonas } from '../hooks/useData'
import { api } from '../lib/api'
import { COLORES, TIPOS_VINCULO, labelDe } from '../lib/constants'
import { TIPOS_CONTACTO, contactosAObjeto, linkContacto, objetoAContactos } from '../lib/contactos'
import { iniciales } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { confirmar } from '../store/confirmStore'

function PersonaForm({ inicial, onClose }) {
  const qc = useQueryClient()
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
      return inicial?.id ? api.put(`personal/${inicial.id}/`, body) : api.post('personal/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal'] })
      notify(inicial?.id ? 'Persona actualizada' : 'Persona agregada')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar'),
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
        <Field label="Puesto">
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
    </Modal>
  )
}

export default function Equipo() {
  const qc = useQueryClient()
  const q = usePersonas()
  const [editando, setEditando] = useState(null)
  const [asignando, setAsignando] = useState(null)
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
                {p.usuario ? <div className="small muted">Usuario: {p.usuario}</div> : null}
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
      {asignando ? <AsignacionForm personaId={asignando.id} onClose={() => setAsignando(null)} /> : null}
    </>
  )
}
