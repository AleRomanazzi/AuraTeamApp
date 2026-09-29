import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import Tabs from '../components/ui/Tabs'
import Tag from '../components/ui/Tag'
import { isSignedIn, signOutGoogle } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { useCategorias, useMe, usePersonas } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { COLORES } from '../lib/constants'
import { formatFechaHora } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { QK } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

function Perfil({ me }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ first_name: me.first_name || '', last_name: me.last_name || '', email: me.email || '', nombre_display: me.nombre_display || '' })
  const [pw, setPw] = useState({ actual: '', nueva: '', repetir: '' })
  const guardar = useMutation({
    mutationFn: () => api.put('me/config/', f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.me })
      notify('Perfil guardado')
    },
    onError: (e) => notifyError(e, 'No se pudo guardar'),
  })
  const cambiarPw = useMutation({
    mutationFn: () => api.post('auth/password/', { actual: pw.actual, nueva: pw.nueva }),
    onSuccess: () => {
      setPw({ actual: '', nueva: '', repetir: '' })
      notify('Contraseña actualizada')
    },
    onError: (e) => notifyError(e, 'No se pudo cambiar la contraseña'),
  })
  return (
    <div className="grid-2">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          guardar.mutate()
        }}
      >
        <div className="card-title">
          <span className="dot" /> Mi perfil
        </div>
        <div className="grid-2 tight">
          <Field label="Nombre">
            <input value={f.first_name} onChange={(e) => setF((s) => ({ ...s, first_name: e.target.value }))} />
          </Field>
          <Field label="Apellido">
            <input value={f.last_name} onChange={(e) => setF((s) => ({ ...s, last_name: e.target.value }))} />
          </Field>
        </div>
        <Field label="Email">
          <input type="email" value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} />
        </Field>
        <Field label="Nombre visible en el panel">
          <input value={f.nombre_display} onChange={(e) => setF((s) => ({ ...s, nombre_display: e.target.value }))} />
        </Field>
        <div className="small muted" style={{ marginBottom: 12 }}>
          Usuario: <strong>{me.username}</strong> · Rol: <strong>{me.es_admin ? 'Administrador' : 'Equipo'}</strong>
          {me.persona_nombre ? ` · Vinculado a ${me.persona_nombre}` : ''}
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={guardar.isPending}>
          Guardar
        </button>
      </form>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          if (pw.nueva !== pw.repetir) {
            notify('Las contraseñas nuevas no coinciden', 'error')
            return
          }
          cambiarPw.mutate()
        }}
      >
        <div className="card-title">
          <span className="dot" style={{ background: 'var(--accent2)' }} /> Cambiar contraseña
        </div>
        <Field label="Contraseña actual">
          <input type="password" autoComplete="current-password" value={pw.actual} onChange={(e) => setPw((s) => ({ ...s, actual: e.target.value }))} required />
        </Field>
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, que no sea solo números ni muy común.">
          <input type="password" autoComplete="new-password" value={pw.nueva} onChange={(e) => setPw((s) => ({ ...s, nueva: e.target.value }))} required minLength={8} />
        </Field>
        <Field label="Repetir nueva contraseña">
          <input type="password" autoComplete="new-password" value={pw.repetir} onChange={(e) => setPw((s) => ({ ...s, repetir: e.target.value }))} required />
        </Field>
        <button type="submit" className="btn btn-primary btn-sm" disabled={cambiarPw.isPending}>
          Cambiar contraseña
        </button>
      </form>
    </div>
  )
}

const RESULTADO_GOOGLE = {
  ok: ['Cuenta de Google de la agencia conectada', 'success'],
  cancelado: ['Se canceló la conexión con Google', 'error'],
}

/** Muestra una sola vez el resultado con el que vuelve Google (?google=ok|error|cancelado) y limpia la URL. */
function useResultadoGoogle() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const resultado = sp.get('google')
  const motivo = sp.get('motivo')
  useEffect(() => {
    if (!resultado) return
    const [msg, tipo] = RESULTADO_GOOGLE[resultado] || [`No se pudo conectar Google${motivo ? `: ${motivo}` : ''}`, 'error']
    notify(msg, tipo)
    qc.invalidateQueries({ queryKey: QK.me })
    qc.invalidateQueries({ queryKey: QK.googleEstado })
    setSp({ tab: 'google' }, { replace: true })
  }, [resultado, motivo, qc, setSp])
}

function Google({ me }) {
  const qc = useQueryClient()
  useResultadoGoogle()
  useGoogleStore((s) => s.tokenVersion)
  const q = useQuery({ queryKey: QK.googleEstado, queryFn: () => api.get('auth/google/').then((r) => r.data) })

  const conectar = useMutation({
    mutationFn: () => api.post('auth/google/conectar/').then((r) => r.data),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => notifyError(e, 'No se pudo iniciar la conexión con Google'),
  })

  const desconectar = useMutation({
    mutationFn: () => api.post('auth/google/desconectar/'),
    onSuccess: async () => {
      signOutGoogle()
      useGoogleStore.getState().reset()
      qc.removeQueries({ queryKey: ['google-calendar'] })
      qc.removeQueries({ queryKey: ['gmail'] })
      await Promise.all([qc.invalidateQueries({ queryKey: QK.me }), qc.invalidateQueries({ queryKey: QK.googleEstado })])
      notify('Cuenta de Google desconectada')
    },
    onError: (e) => notifyError(e),
  })

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-title">
        <span className="dot" /> Google (Gmail y Calendar)
      </div>
      <QueryState query={q}>
        {(estado) => (
          <>
            <p className="small">
              Estado: {estado.conectado ? <Tag color="green">Conectada</Tag> : <Tag>No conectada</Tag>}
              {estado.conectado ? (
                <span className="muted">
                  {' '}
                  · {estado.email || 'cuenta de la agencia'} · desde {formatFechaHora(estado.conectada_en)}
                  {me.es_admin ? (isSignedIn() ? ' · activa en este navegador' : ' · cargando en este navegador…') : ''}
                </span>
              ) : null}
            </p>
            {!estado.configurado ? (
              <div className="info-box">Faltan las credenciales de Google en el servidor (AURA_GOOGLE_CLIENT_ID y AURA_GOOGLE_CLIENT_SECRET).</div>
            ) : estado.conectado ? (
              <div className="info-box">
                La cuenta queda conectada de forma permanente para todo el panel: no hace falta volver a iniciar sesión en Google en cada navegador ni al entrar.
              </div>
            ) : (
              <div className="info-box">
                Conectá una sola vez la cuenta de la agencia{estado.cuenta_sugerida ? ` (${estado.cuenta_sugerida})` : ''}. Google te va a pedir que elijas la cuenta y aceptes los permisos de Gmail y Calendar.
              </div>
            )}
            {me.es_admin && estado.configurado ? (
              <div className="header-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={conectar.isPending} onClick={() => conectar.mutate()}>
                  {conectar.isPending ? 'Redirigiendo a Google…' : estado.conectado ? 'Cambiar o reconectar cuenta' : 'Conectar cuenta de Google'}
                </button>
                {estado.conectado ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={desconectar.isPending}
                    onClick={async () =>
                      (await confirmar({ mensaje: 'Se va a desconectar la cuenta de Google para todo el panel (Gmail y Calendar dejan de funcionar hasta reconectar).', peligro: true, confirmar: 'Desconectar' })) &&
                      desconectar.mutate()
                    }
                  >
                    Desconectar
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </QueryState>
    </div>
  )
}

function UsuarioForm({ inicial, onClose }) {
  const qc = useQueryClient()
  const { data: personas = [] } = usePersonas()
  const [f, setF] = useState(() => ({
    username: inicial?.username ?? '',
    first_name: inicial?.first_name ?? '',
    last_name: inicial?.last_name ?? '',
    email: inicial?.email ?? '',
    rol: inicial?.rol ?? 'equipo',
    persona: inicial?.persona ?? '',
    is_active: inicial?.is_active ?? true,
    password: '',
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const guardar = useMutation({
    mutationFn: () => {
      const body = { ...f, persona: f.persona || null }
      if (!body.password) delete body.password
      return inicial?.id ? api.put(`usuarios/${inicial.id}/`, body) : api.post('usuarios/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.usuarios })
      notify('Usuario guardado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar el usuario'),
  })
  return (
    <Modal
      title={inicial?.id ? `Editar ${inicial.username}` : 'Nuevo usuario'}
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
        <Field label="Rol" hint={f.rol === 'admin' ? 'Ve todo: finanzas, clientes y configuración.' : 'Solo ve sus tareas, sus pagos y el calendario.'}>
          <select value={f.rol} onChange={set('rol')}>
            <option value="equipo">Equipo</option>
            <option value="admin">Administrador</option>
          </select>
        </Field>
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
      </div>
      <Field label={inicial?.id ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña'}>
        <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required={!inicial?.id} minLength={8} />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => setF((s) => ({ ...s, is_active: e.target.checked }))} /> Activo
      </label>
    </Modal>
  )
}

function Usuarios({ me }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK.usuarios, queryFn: () => getList('usuarios/') })
  const [editando, setEditando] = useState(null)
  const desactivar = useMutation({
    mutationFn: (id) => api.delete(`usuarios/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.usuarios })
      notify('Usuario desactivado')
    },
    onError: (e) => notifyError(e),
  })
  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" /> Usuarios con acceso
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
          + Usuario
        </button>
      </div>
      <QueryState query={q}>
        {(lista) => (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Persona</th>
                  <th>Último acceso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((u) => (
                  <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                    <td>
                      <div className="cell-title">{u.username}</div>
                      <div className="cell-sub">{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email}</div>
                    </td>
                    <td>
                      <Tag color={u.rol === 'admin' ? 'purple' : ''}>{u.rol === 'admin' ? 'Admin' : 'Equipo'}</Tag>
                      {!u.is_active ? <Tag color="red">Inactivo</Tag> : null}
                    </td>
                    <td>{u.persona_nombre || <span className="muted">—</span>}</td>
                    <td className="small">{u.last_login ? formatFechaHora(u.last_login) : 'Nunca'}</td>
                    <td className="nowrap">
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(u)}>
                        Editar
                      </button>{' '}
                      {u.id !== me.id && u.is_active ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          onClick={async () => (await confirmar({ mensaje: `¿Quitarle el acceso a ${u.username}?`, peligro: true, confirmar: 'Desactivar' })) && desactivar.mutate(u.id)}
                        >
                          Desactivar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {editando ? <UsuarioForm inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
    </div>
  )
}

function Categorias() {
  const qc = useQueryClient()
  const q = useCategorias()
  const [nueva, setNueva] = useState({ nombre: '', tipo: 'egreso', color: COLORES[0] })
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: QK.categorias })
    qc.invalidateQueries({ queryKey: ['transacciones'] })
  }
  const crear = useMutation({
    mutationFn: () => api.post('categorias/', nueva),
    onSuccess: () => {
      setNueva((s) => ({ ...s, nombre: '' }))
      refrescar()
      notify('Categoría creada')
    },
    onError: (e) => notifyError(e, 'No se pudo crear'),
  })
  const actualizar = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`categorias/${id}/`, body),
    onSuccess: refrescar,
    onError: (e) => notifyError(e),
  })
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`categorias/${id}/`),
    onSuccess: (r) => {
      refrescar()
      notify(r.status === 200 ? 'Tenía movimientos: quedó desactivada' : 'Categoría eliminada')
    },
    onError: (e) => notifyError(e),
  })
  return (
    <div className="card">
      <div className="card-title">
        <span className="dot" /> Categorías de ingresos y egresos
      </div>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault()
          crear.mutate()
        }}
      >
        <input placeholder="Nueva categoría" value={nueva.nombre} onChange={(e) => setNueva((s) => ({ ...s, nombre: e.target.value }))} required maxLength={60} aria-label="Nombre de la categoría" />
        <select value={nueva.tipo} onChange={(e) => setNueva((s) => ({ ...s, tipo: e.target.value }))} aria-label="Tipo">
          <option value="ingreso">Ingreso</option>
          <option value="egreso">Egreso</option>
        </select>
        <input type="color" value={nueva.color} onChange={(e) => setNueva((s) => ({ ...s, color: e.target.value }))} aria-label="Color" />
        <button type="submit" className="btn btn-primary btn-sm" disabled={crear.isPending}>
          Agregar
        </button>
      </form>
      <QueryState query={q}>
        {(lista) => (
          <div className="grid-2 tight">
            {['ingreso', 'egreso'].map((tipo) => (
              <div key={tipo}>
                <h4 className={tipo === 'ingreso' ? 'up' : 'down'}>{tipo === 'ingreso' ? 'Ingresos' : 'Egresos'}</h4>
                {lista
                  .filter((c) => c.tipo === tipo)
                  .map((c) => (
                    <div key={c.id} className={`list-row${c.activa ? '' : ' row-muted'}`}>
                      <input type="color" value={c.color} onChange={(e) => actualizar.mutate({ id: c.id, color: e.target.value })} aria-label={`Color de ${c.nombre}`} className="color-mini" />
                      <div className="list-row-main">
                        <div className="list-row-title">{c.nombre}</div>
                      </div>
                      <label className="check-row small">
                        <input type="checkbox" checked={c.activa} onChange={(e) => actualizar.mutate({ id: c.id, activa: e.target.checked })} /> Activa
                      </label>
                      <button
                        type="button"
                        className="link-btn down"
                        aria-label={`Eliminar ${c.nombre}`}
                        onClick={async () => (await confirmar({ mensaje: `¿Eliminar «${c.nombre}»? Si tiene movimientos se desactiva.`, peligro: true, confirmar: 'Eliminar' })) && borrar.mutate(c.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  )
}

function Datos() {
  const qc = useQueryClient()
  const input = useRef(null)
  const [resultado, setResultado] = useState(null)
  const exportar = useMutation({
    mutationFn: () => api.get('me/export/').then((r) => r.data),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aurateam-respaldo-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify('Respaldo descargado')
    },
    onError: (e) => notifyError(e, 'No se pudo exportar'),
  })
  const importar = useMutation({
    mutationFn: async (file) => {
      let body
      try {
        body = JSON.parse(await file.text())
      } catch {
        throw new Error('El archivo no es un JSON válido.')
      }
      return api.post('me/import/', body).then((r) => r.data)
    },
    onSuccess: (d) => {
      setResultado(d)
      qc.invalidateQueries()
      notify(d.total_errores ? `Importado con ${d.total_errores} errores` : 'Datos importados')
    },
    onError: (e) => notifyError(e, e?.message || 'No se pudo importar'),
  })
  const borrar = useMutation({
    mutationFn: () => api.delete('me/data/', { data: { confirmar: 'BORRAR' } }),
    onSuccess: () => {
      qc.invalidateQueries()
      notify('Datos borrados')
    },
    onError: (e) => notifyError(e),
  })
  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-title">
          <span className="dot" /> Respaldo
        </div>
        <p className="small muted">Descargá un archivo con todos los datos de la agencia (clientes, cobros, movimientos, equipo, suscripciones y agenda). Guardalo en un lugar seguro.</p>
        <button type="button" className="btn btn-primary btn-sm" disabled={exportar.isPending} onClick={() => exportar.mutate()}>
          ⬇ Descargar respaldo
        </button>
      </div>
      <div className="card">
        <div className="card-title">
          <span className="dot" style={{ background: 'var(--gold)' }} /> Restaurar respaldo
        </div>
        <p className="small muted">Reemplaza todos los datos actuales por los del archivo. Primero descargá un respaldo de lo que hay hoy.</p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={importar.isPending}
          onClick={async () => (await confirmar({ titulo: 'Restaurar respaldo', mensaje: 'Se van a reemplazar TODOS los datos actuales de la agencia.', peligro: true, escribir: 'RESTAURAR', confirmar: 'Elegir archivo' })) && input.current?.click()}
        >
          {importar.isPending ? 'Importando…' : '⬆ Importar archivo'}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) importar.mutate(file)
          }}
        />
        {resultado ? (
          <div className="info-box" style={{ marginTop: 12 }}>
            <div>Registros importados: {Object.entries(resultado.creados || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '0'}</div>
            {resultado.total_errores ? (
              <details>
                <summary className="down">{resultado.total_errores} filas con errores</summary>
                <ul className="small">
                  {resultado.errores.map((er, i) => (
                    <li key={i}>{typeof er === 'string' ? er : JSON.stringify(er)}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="card danger-zone">
        <div className="card-title">
          <span className="dot" style={{ background: 'var(--accent3)' }} /> Zona peligrosa
        </div>
        <p className="small muted">Borra todos los datos de la agencia. Los usuarios se conservan.</p>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={borrar.isPending}
          onClick={async () => (await confirmar({ titulo: 'Borrar todos los datos', mensaje: 'Esta acción no se puede deshacer.', peligro: true, escribir: 'BORRAR', confirmar: 'Borrar todo' })) && borrar.mutate()}
        >
          Borrar todos los datos
        </button>
      </div>
    </div>
  )
}

export default function Config() {
  const { data: me } = useMe()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') || 'perfil'
  if (!me) return null
  const tabs = [
    { value: 'perfil', label: 'Perfil' },
    { value: 'google', label: 'Google' },
    ...(me.es_admin
      ? [
          { value: 'usuarios', label: 'Usuarios' },
          { value: 'categorias', label: 'Categorías' },
          { value: 'datos', label: 'Datos' },
        ]
      : []),
  ]
  const actual = tabs.some((t) => t.value === tab) ? tab : 'perfil'
  return (
    <>
      <PageHeader titulo="Configuración" />
      <div style={{ marginBottom: 16 }}>
        <Tabs tabs={tabs} value={actual} onChange={(v) => setSp(v === 'perfil' ? {} : { tab: v }, { replace: true })} />
      </div>
      {actual === 'perfil' ? <Perfil key={me.id} me={me} /> : null}
      {actual === 'google' ? <Google key={me.id} me={me} /> : null}
      {actual === 'usuarios' ? <Usuarios me={me} /> : null}
      {actual === 'categorias' ? <Categorias /> : null}
      {actual === 'datos' ? <Datos /> : null}
    </>
  )
}
