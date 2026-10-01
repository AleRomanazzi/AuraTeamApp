import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import { useMe, usePersonas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { DIAS_SEMANA, ETIQUETAS_TAREA, labelDe } from '../../lib/constants'
import { celdasMes, currentMonth, formatFecha, iniciales, monthLabel, shiftMonth } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { TAREAS, invalidar } from '../../lib/queryKeys'

const pad = (n) => String(n).padStart(2, '0')

/** Misma posición en la grilla semanal: el 2.º martes pasa al 2.º martes (o al último, si el mes no tiene 5.º). */
function mismoDiaDeSemana(fecha, mes) {
  const [, , d] = fecha.split('-').map(Number)
  const semana = Math.ceil(d / 7)
  const dow = new Date(`${fecha}T12:00`).getDay()
  const [y, m] = mes.split('-').map(Number)
  const primero = new Date(y, m - 1, 1).getDay()
  const ultimo = new Date(y, m, 0).getDate()
  let dia = 1 + ((dow - primero + 7) % 7) + (semana - 1) * 7
  while (dia > ultimo) dia -= 7
  return `${mes}-${pad(dia)}`
}

const clave = (fecha, titulo) => `${fecha}|${titulo.trim().toLowerCase()}`

let siguiente = 0
const fila = (datos) => ({ key: ++siguiente, incluir: true, descripcion: '', prioridad: 'media', ...datos })

/** Varias tareas de un cliente de una vez: carga rápida por días o copia del mes anterior, editable antes de crear. */
export default function PlanMesModal({ cliente, tareas, onClose }) {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const { data: personas = [] } = usePersonas()
  const [mes, setMes] = useState(() => shiftMonth(currentMonth(), new Date().getDate() >= 20 ? 1 : 0))
  const [borrador, setBorrador] = useState([])
  const [rapida, setRapida] = useState(null)

  const nombre = (id) => personas.find((p) => p.id === id)?.nombre ?? '?'
  const delMes = (m) => tareas.filter((t) => !t.recurrente && t.fecha_limite?.startsWith(m)).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite))
  const cargadas = delMes(mes)
  const anterior = delMes(shiftMonth(mes, -1))
  const existentes = new Set(cargadas.map((t) => clave(t.fecha_limite, t.titulo)))
  const incluidas = borrador.filter((f) => f.incluir)

  const cambiarMes = (delta) => {
    const nuevo = shiftMonth(mes, delta)
    setBorrador((b) => b.map((f) => ({ ...f, fecha: mismoDiaDeSemana(f.fecha, nuevo) })))
    setRapida((r) => (r ? { ...r, dias: [] } : r))
    setMes(nuevo)
  }

  const copiarAnterior = () => {
    const usadas = new Set([...existentes, ...borrador.map((f) => clave(f.fecha, f.titulo))])
    const nuevas = anterior
      .map((t) => ({ ...t, fecha: mismoDiaDeSemana(t.fecha_limite, mes) }))
      .filter((t) => !usadas.has(clave(t.fecha, t.titulo)))
      .map((t) => fila({ fecha: t.fecha, titulo: t.titulo, etiqueta: t.etiqueta, prioridad: t.prioridad, descripcion: t.descripcion, asignados: t.asignados }))
    if (!nuevas.length) return notify('Esas tareas ya están en el borrador o cargadas en el mes.', 'error')
    setBorrador((b) => [...b, ...nuevas])
  }

  const abrirRapida = () =>
    setRapida({ titulo: '', etiqueta: 'posteos', asignados: me?.persona && !me.es_admin ? [me.persona] : [], dias: [], numerar: true })

  const agregarRapida = () => {
    const dias = [...rapida.dias].sort()
    const base = rapida.titulo.trim()
    setBorrador((b) => [
      ...b,
      ...dias.map((fecha, i) =>
        fila({ fecha, titulo: rapida.numerar && dias.length > 1 ? `${base} ${i + 1}` : base, etiqueta: rapida.etiqueta, asignados: rapida.asignados }),
      ),
    ])
    setRapida(null)
  }

  const editar = (key, cambios) => setBorrador((b) => b.map((f) => (f.key === key ? { ...f, ...cambios } : f)))
  const alternarEn = (lista, v) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v])

  const crear = useMutation({
    mutationFn: () =>
      api.post('tareas/plan/', {
        cliente: cliente.id,
        tareas: incluidas.map((f) => ({
          titulo: f.titulo,
          fecha_limite: f.fecha,
          etiqueta: f.etiqueta,
          prioridad: f.prioridad,
          descripcion: f.descripcion,
          asignados: f.asignados,
        })),
      }),
    onSuccess: ({ data }) => {
      invalidar(qc, [...TAREAS, 'notion', 'cal-google'])
      notify(`Se crearon ${data.creadas} tareas. Van llegando a Notion y al calendario.`)
      setBorrador([])
    },
    onError: (e) => notifyError(e, 'No se pudieron crear las tareas'),
  })

  const [y, m] = mes.split('-')
  const limites = { min: `${mes}-01`, max: `${mes}-${pad(new Date(Number(y), Number(m), 0).getDate())}` }

  return (
    <Modal
      title={`Plan del mes · ${cliente.nombre}`}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <span className="modal-total">{borrador.length ? `${incluidas.length} de ${borrador.length} filas marcadas` : null}</span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="btn btn-primary" disabled={!incluidas.length || crear.isPending} onClick={() => crear.mutate()}>
            {crear.isPending ? 'Creando…' : incluidas.length ? `Crear ${incluidas.length} tarea${incluidas.length === 1 ? '' : 's'}` : 'Crear tareas'}
          </button>
        </>
      }
    >
      <div className="plan-mes-nav">
        <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes anterior" onClick={() => cambiarMes(-1)}>
          ◀
        </button>
        <strong>{monthLabel(mes)}</strong>
        <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes siguiente" onClick={() => cambiarMes(1)}>
          ▶
        </button>
      </div>

      <section className="plan-seccion">
        <div className="tc-seccion">
          Ya cargadas en {monthLabel(mes, { month: 'long' })} ({cargadas.length})
        </div>
        {cargadas.length ? (
          <ul className="plan-cargadas">
            {cargadas.map((t) => (
              <li key={t.id} className={t.estado === 'hecha' ? 'plan-hecha' : ''}>
                <span className="plan-fecha">{formatFecha(t.fecha_limite, { weekday: 'short', day: 'numeric' })}</span>
                <span className="plan-titulo">{t.titulo}</span>
                <span className="muted small">{labelDe(ETIQUETAS_TAREA, t.etiqueta)}</span>
                <span className="muted small">{t.asignados.map(nombre).join(', ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Todavía no hay tareas de este cliente con fecha en este mes (las historias automáticas no se muestran).</p>
        )}
      </section>

      <div className="plan-acciones">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!anterior.length} onClick={copiarAnterior}>
          ⧉ Copiar {monthLabel(shiftMonth(mes, -1), { month: 'long' })} ({anterior.length})
        </button>
        {rapida ? null : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={abrirRapida}>
            + Carga rápida
          </button>
        )}
      </div>

      {rapida ? (
        <section className="plan-rapida">
          <div className="grid-2 tight">
            <Field label="Título" hint={rapida.numerar && rapida.dias.length > 1 ? `Se numeran: «${rapida.titulo || 'Posteo'} 1», «2»…` : null}>
              <input value={rapida.titulo} onChange={(e) => setRapida((r) => ({ ...r, titulo: e.target.value }))} maxLength={170} placeholder="Posteo" />
            </Field>
            <Field label="Calendario">
              <select value={rapida.etiqueta} onChange={(e) => setRapida((r) => ({ ...r, etiqueta: e.target.value }))}>
                {ETIQUETAS_TAREA.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Responsables">
            <div className="chip-select">
              {personas
                .filter((p) => p.activo)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`chip${rapida.asignados.includes(p.id) ? ' active' : ''}`}
                    aria-pressed={rapida.asignados.includes(p.id)}
                    onClick={() => setRapida((r) => ({ ...r, asignados: alternarEn(r.asignados, p.id) }))}
                  >
                    {p.nombre}
                  </button>
                ))}
            </div>
          </Field>
          <Field label={`Días (${rapida.dias.length})`}>
            <div className="plan-cal">
              {DIAS_SEMANA.map((d) => (
                <span key={d} className="tc-mes-head">
                  {d}
                </span>
              ))}
              {celdasMes(mes).map((dia, i) =>
                dia ? (
                  <button
                    key={dia}
                    type="button"
                    className={`plan-cal-dia${rapida.dias.includes(dia) ? ' active' : ''}`}
                    aria-pressed={rapida.dias.includes(dia)}
                    onClick={() => setRapida((r) => ({ ...r, dias: alternarEn(r.dias, dia) }))}
                  >
                    {Number(dia.slice(8))}
                  </button>
                ) : (
                  <span key={`v${i}`} />
                ),
              )}
            </div>
          </Field>
          <div className="plan-rapida-pie">
            <label className="check-row">
              <input type="checkbox" checked={rapida.numerar} onChange={(e) => setRapida((r) => ({ ...r, numerar: e.target.checked }))} />
              Numerar
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRapida(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!rapida.titulo.trim() || !rapida.dias.length} onClick={agregarRapida}>
              Agregar {rapida.dias.length || ''} al borrador
            </button>
          </div>
        </section>
      ) : null}

      {borrador.length ? (
        <section className="plan-seccion">
          <div className="tc-seccion plan-borrador-head">
            Borrador ({borrador.length})
            <button type="button" className="link-btn" onClick={() => setBorrador([])}>
              Vaciar
            </button>
          </div>
          <div className="plan-borrador">
            {[...borrador]
              .sort((a, b) => a.fecha.localeCompare(b.fecha))
              .map((f) => {
                const repetida = existentes.has(clave(f.fecha, f.titulo))
                return (
                  <div key={f.key} className={`plan-fila${f.incluir ? '' : ' plan-fila--fuera'}`}>
                    <input type="checkbox" aria-label="Incluir" checked={f.incluir} onChange={(e) => editar(f.key, { incluir: e.target.checked })} />
                    <input type="date" aria-label="Fecha" {...limites} value={f.fecha} onChange={(e) => e.target.value && editar(f.key, { fecha: e.target.value })} />
                    <div className="plan-fila-titulo">
                      <input aria-label="Título" value={f.titulo} maxLength={180} onChange={(e) => editar(f.key, { titulo: e.target.value })} />
                      {repetida ? <span className="small down">Ya existe ese día</span> : null}
                    </div>
                    <select className="select-sm" aria-label="Calendario" value={f.etiqueta} onChange={(e) => editar(f.key, { etiqueta: e.target.value })}>
                      {ETIQUETAS_TAREA.map((e) => (
                        <option key={e.value} value={e.value}>
                          {e.label}
                        </option>
                      ))}
                    </select>
                    <span className="tc-caras" title={f.asignados.map(nombre).join(', ') || 'Sin responsable'}>
                      {f.asignados.slice(0, 3).map((id) => (
                        <span key={id} className="tc-cara" style={{ background: personas.find((p) => p.id === id)?.color }}>
                          {iniciales(nombre(id))}
                        </span>
                      ))}
                    </span>
                    <button type="button" className="modal-close plan-quitar" aria-label="Quitar fila" onClick={() => setBorrador((b) => b.filter((x) => x.key !== f.key))}>
                      ×
                    </button>
                  </div>
                )
              })}
          </div>
          <p className="muted small">Las fechas copiadas respetan el día de la semana (el 2.º martes pasa al 2.º martes). Después de crear, cada tarea se edita como cualquier otra.</p>
        </section>
      ) : null}
    </Modal>
  )
}
