import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModal } from '../../context/ModalContext'
import { usePhase1 } from '../../context/Phase1Context'
import { sendMessage } from '../../features/google/gmailApi'
import { insertPrimaryCalendarEvent } from '../../features/google/calendarApi'
import { isSignedIn } from '../../features/google/gapiClient'
import { api } from '../../lib/api'
import { personaToApi, servicioToApiPayload } from '../../lib/mappers'
import { parseAmountLoose, roundMoney2, splitMoneyExact } from '../../lib/serviciosAmounts'
import { QK } from '../../lib/queryKeys'
import { useModalStore } from '../../store/modalStore'
import { notify } from '../../lib/notify'

function stop(e) {
  e.stopPropagation()
}

function toDatetimeLocalValue(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function AppModals() {
  const { openModals, closeModal, eventoTipo, eventoPreset } = useModal()
  const modalEventoOpen = Boolean(openModals['modal-evento'])
  const { state } = usePhase1()
  const qc = useQueryClient()

  useEffect(() => {
    if (!modalEventoOpen || !eventoPreset) return undefined
    const { year, monthIndex, day } = eventoPreset
    const tid = window.setTimeout(() => {
      if (eventoTipo === 'cliente') {
        const el = document.getElementById('ev-dia-mes')
        if (el) el.value = String(day)
      } else {
        const start = new Date(year, monthIndex, day, 9, 0)
        const end = new Date(year, monthIndex, day, 10, 0)
        const inicioEl = document.getElementById('ev-inicio')
        const finEl = document.getElementById('ev-fin')
        if (inicioEl) inicioEl.value = toDatetimeLocalValue(start)
        if (finEl) finEl.value = toDatetimeLocalValue(end)
      }
    }, 0)
    return () => window.clearTimeout(tid)
  }, [modalEventoOpen, eventoTipo, eventoPreset])

  const editTxId = useModalStore((s) => s.editTransaccionId)
  const adjuntoTxId = useModalStore((s) => s.adjuntoTransaccionId)
  const editPersonaId = useModalStore((s) => s.editPersonaId)
  const clearTransaccionModal = useModalStore((s) => s.clearTransaccionModal)
  const clearAdjuntoModal = useModalStore((s) => s.clearAdjuntoModal)
  const clearPersonaModal = useModalStore((s) => s.clearPersonaModal)

  const [txTipo, setTxTipo] = useState('ingreso')
  const [txDesc, setTxDesc] = useState('')
  const [txMonto, setTxMonto] = useState('')
  const [txFecha, setTxFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [txCat, setTxCat] = useState('Salario')
  const [txNotas, setTxNotas] = useState('')
  const [servicioPersonaIds, setServicioPersonaIds] = useState([])
  const [servicioFechaPago, setServicioFechaPago] = useState(() => new Date().toISOString().slice(0, 10))

  const servicioOpen = openModals['modal-servicio']
  useEffect(() => {
    if (!servicioOpen) return
    queueMicrotask(() => {
      setServicioPersonaIds([])
      setServicioFechaPago(new Date().toISOString().slice(0, 10))
      const extra = document.getElementById('srv-personas-extra')
      if (extra) extra.value = ''
    })
  }, [servicioOpen])

  const txOpen = openModals['modal-transaccion']
  useEffect(() => {
    if (!txOpen) return
    queueMicrotask(() => {
      if (editTxId) {
        const t = state.transacciones.find((x) => x.id === editTxId)
        if (t) {
          setTxTipo(t.tipo)
          setTxDesc(t.desc)
          setTxMonto(String(t.monto))
          setTxFecha(t.fecha)
          setTxCat(t.cat)
          setTxNotas(t.notas || '')
        }
      } else {
        setTxTipo('ingreso')
        setTxDesc('')
        setTxMonto('')
        setTxFecha(new Date().toISOString().slice(0, 10))
        setTxCat('Salario')
        setTxNotas('')
      }
    })
  }, [txOpen, editTxId, state.transacciones])

  const saveTx = useMutation({
    mutationFn: async () => {
      const body = {
        fecha: txFecha,
        descripcion: txDesc,
        categoria: txCat,
        tipo: txTipo,
        monto: txMonto,
        notas: txNotas,
      }
      if (editTxId) await api.put(`transacciones/${editTxId}/`, body)
      else await api.post('transacciones/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.transacciones })
      notify(editTxId ? 'Transacción actualizada' : 'Transacción creada')
      closeModal('modal-transaccion')
      clearTransaccionModal()
    },
    onError: () => notify('No se pudo guardar la transacción'),
  })

  const saveAdjunto = useMutation({
    mutationFn: async () => {
      const input = document.getElementById('adjunto-file')
      const file = input?.files?.[0]
      if (!file || !adjuntoTxId) throw new Error('Falta archivo o transacción')
      const fd = new FormData()
      fd.append('archivo', file)
      await api.post(`transacciones/${adjuntoTxId}/adjuntos/`, fd)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.transacciones })
      notify('Adjunto subido')
      closeModal('modal-adjunto')
      clearAdjuntoModal()
      const input = document.getElementById('adjunto-file')
      if (input) input.value = ''
    },
    onError: () => notify('No se pudo subir el adjunto'),
  })

  const saveServicio = useMutation({
    mutationFn: async ({ personaIds, fechaPago } = {}) => {
      const nombre = document.getElementById('srv-nombre')?.value?.trim() || 'Servicio'
      const monto = roundMoney2(parseAmountLoose(document.getElementById('srv-monto')?.value))
      const periodo = document.getElementById('srv-periodo')?.value || 'mensual'
      const extraRaw = document.getElementById('srv-personas-extra')?.value?.trim() || ''
      const extraNames = extraRaw
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const fromPersonal = (personaIds ?? [])
        .map((id) => state.personal.find((p) => String(p.id) === String(id))?.nombre)
        .filter(Boolean)
      const uniq = [...new Set([...fromPersonal, ...extraNames])]
      const personas = uniq.length ? uniq.join(', ') : 'No especificado'
      const dia = parseInt(document.getElementById('srv-dia')?.value, 10) || 1
      const n = Math.max(1, uniq.length)
      const amounts = splitMoneyExact(monto, n)
      const detallePersonas =
        uniq.length > 0
          ? uniq.map((name, i) => ({
              name,
              monto: roundMoney2(amounts[i] ?? 0),
            }))
          : []
      const payload = servicioToApiPayload({
        nombre,
        monto,
        periodo,
        personas,
        dia,
        metodo: 'partes-iguales',
        detallePersonas,
        fechaPago: fechaPago || undefined,
      })
      await api.post('servicios/', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.servicios })
      notify('Servicio guardado')
      closeModal('modal-servicio')
    },
    onError: () => notify('No se pudo guardar el servicio'),
  })

  const [pNombre, setPNombre] = useState('')
  const [pPuesto, setPPuesto] = useState('')
  const [pTel, setPTel] = useState('')
  const [pEmail, setPEmail] = useState('')
  const [pIg, setPIg] = useState('')
  const [pTelegram, setPTelegram] = useState('')
  const [pOtro, setPOtro] = useState('')
  const [pNotas, setPNotas] = useState('')

  const pOpen = openModals['modal-personal']
  useEffect(() => {
    if (!pOpen) return
    queueMicrotask(() => {
      if (editPersonaId) {
        const p = state.personal.find((x) => x.id === editPersonaId)
        if (p) {
          setPNombre(p.nombre)
          setPPuesto(p.puesto)
          setPTel(p.tel)
          setPEmail(p.email)
          setPIg(p.ig)
          setPTelegram(p.telegram)
          setPOtro(p.otro)
          setPNotas(p.notas)
        }
      } else {
        setPNombre('')
        setPPuesto('')
        setPTel('')
        setPEmail('')
        setPIg('')
        setPTelegram('')
        setPOtro('')
        setPNotas('')
      }
    })
  }, [pOpen, editPersonaId, state.personal])

  const savePersona = useMutation({
    mutationFn: async () => {
      const existing = editPersonaId ? state.personal.find((x) => x.id === editPersonaId) : null
      const body = personaToApi({
        nombre: pNombre,
        puesto: pPuesto,
        tel: pTel,
        email: pEmail,
        ig: pIg,
        telegram: pTelegram,
        otro: pOtro,
        notas: pNotas,
        color: existing?.color || '#7c6fff',
      })
      if (editPersonaId) await api.put(`personal/${editPersonaId}/`, body)
      else await api.post('personal/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal'] })
      notify(editPersonaId ? 'Persona actualizada' : 'Persona creada')
      closeModal('modal-personal')
      clearPersonaModal()
    },
    onError: () => notify('No se pudo guardar'),
  })

  const sendEmailMut = useMutation({
    mutationFn: async () => {
      const to = document.getElementById('email-to')?.value?.trim()
      const subject = document.getElementById('email-subject')?.value?.trim()
      const body = document.getElementById('email-body')?.value || ''
      if (!to || !subject || !body) throw new Error('Completá Para, Asunto y Mensaje')
      if (!isSignedIn()) throw new Error('Conectá Google primero (Configuración)')
      await sendMessage({ to, subject, body })
    },
    onSuccess: () => {
      closeModal('modal-email')
      notify('Correo enviado')
    },
    onError: (e) => notify(e.message || 'No se pudo enviar'),
  })

  const saveTarea = useMutation({
    mutationFn: async () => {
      const titulo = document.getElementById('tarea-nombre')?.value?.trim() || 'Tarea'
      const descripcion = document.getElementById('tarea-desc')?.value || ''
      await api.post('tareas/', { titulo, descripcion })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.tareas })
      notify('Tarea creada')
      closeModal('modal-tarea')
    },
    onError: () => notify('No se pudo crear la tarea'),
  })

  const saveEvento = useMutation({
    mutationFn: async () => {
      const titulo = document.getElementById('ev-titulo')?.value?.trim() || 'Evento'
      const color = document.getElementById('ev-color')?.value || '#4fffb0'
      if (eventoTipo === 'cliente') {
        const dia_mes = parseInt(document.getElementById('ev-dia-mes')?.value, 10) || 1
        const descripcion = document.getElementById('ev-cliente-desc')?.value || ''
        const montoRaw = document.getElementById('ev-monto')?.value
        const monto = montoRaw === '' || montoRaw == null ? null : montoRaw
        await api.post('cal-clientes/', { titulo, dia_mes, descripcion, color, monto })
        return { kind: 'cliente' }
      }
      const inicio = document.getElementById('ev-inicio')?.value
      const finRaw = document.getElementById('ev-fin')?.value
      const fin = finRaw && String(finRaw).trim() ? finRaw : null
      const descripcion = document.getElementById('ev-desc')?.value || ''
      if (!inicio) throw new Error('Falta fecha inicio')
      await api.post('cal-eventos/', { titulo, inicio, fin, descripcion, color })
      let googleErr = null
      if (isSignedIn()) {
        try {
          await insertPrimaryCalendarEvent({ titulo, descripcion, inicio, fin })
          const d = new Date(inicio)
          if (!Number.isNaN(d.getTime())) {
            await qc.invalidateQueries({ queryKey: QK.googleCal(d.getFullYear(), d.getMonth()) })
          }
        } catch (e) {
          googleErr =
            e?.result?.error?.message ||
            e?.result?.error?.errors?.[0]?.message ||
            e?.message ||
            'Error al crear en Google'
        }
      }
      return { kind: 'unico', googleErr }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: QK.calClientes })
      qc.invalidateQueries({ queryKey: QK.calEventos })
      if (data?.kind === 'cliente') {
        notify('Guardado en calendario')
      } else if (data?.googleErr) {
        notify(`Guardado en la app. No se pudo copiar a Google Calendar: ${data.googleErr}`)
      } else if (isSignedIn()) {
        notify('Guardado en la app y en Google Calendar')
      } else {
        notify('Guardado en la app. Conectá Google en Configuración para copiarlo también a tu cuenta.')
      }
      closeModal('modal-evento')
    },
    onError: (e) => notify(e.message || 'No se pudo guardar'),
  })

  const wrap = (id, inner) => (
    <div
      key={id}
      className={`modal-overlay${openModals[id] ? ' open' : ''}`}
      id={id}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal(id)
      }}
      role="presentation"
    >
      {inner}
    </div>
  )

  return (
    <>
      {wrap(
        'modal-transaccion',
        <div className="modal" onClick={stop} onKeyDown={stop} role="dialog">
          <div className="modal-title" id="modal-tx-title">
            {editTxId ? 'Editar transacción' : 'Nueva transacción'}
          </div>
          <div className="form-row">
            <label>Tipo</label>
            <select id="tx-tipo" value={txTipo} onChange={(e) => setTxTipo(e.target.value)}>
              <option value="ingreso">💚 Ingreso</option>
              <option value="egreso">🔴 Egreso</option>
            </select>
          </div>
          <div className="form-row">
            <label>Descripción</label>
            <input type="text" id="tx-desc" placeholder="Ej: Sueldo de enero" value={txDesc} onChange={(e) => setTxDesc(e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="form-row">
              <label>Monto</label>
              <input type="number" id="tx-monto" placeholder="0.00" value={txMonto} onChange={(e) => setTxMonto(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Fecha</label>
              <input type="date" id="tx-fecha" value={txFecha} onChange={(e) => setTxFecha(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label>Categoría</label>
            <select id="tx-cat" value={txCat} onChange={(e) => setTxCat(e.target.value)}>
              <option>Salario</option>
              <option>Freelance</option>
              <option>Inversión</option>
              <option>Servicios</option>
              <option>Alimentación</option>
              <option>Transporte</option>
              <option>Salud</option>
              <option>Educación</option>
              <option>Entretenimiento</option>
              <option>Otros</option>
            </select>
          </div>
          <div className="form-row">
            <label>Notas (opcional)</label>
            <textarea id="tx-notas" rows={2} placeholder="Detalles adicionales..." value={txNotas} onChange={(e) => setTxNotas(e.target.value)} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => closeModal('modal-transaccion')}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" id="btn-guardar-tx" disabled={saveTx.isPending} onClick={() => saveTx.mutate()}>
              Guardar
            </button>
          </div>
        </div>,
      )}

      {wrap(
        'modal-adjunto',
        <div className="modal" onClick={stop} role="dialog">
          <div className="modal-title">Adjuntar archivo</div>
          <div className="info-box">PDF, imágenes o XML hasta 10 MB.</div>
          <div className="form-row">
            <label>Seleccionar archivo</label>
            <input type="file" id="adjunto-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xml" style={{ padding: '8px' }} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => closeModal('modal-adjunto')}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={saveAdjunto.isPending} onClick={() => saveAdjunto.mutate()}>
              📎 Adjuntar
            </button>
          </div>
        </div>,
      )}

      {wrap(
        'modal-servicio',
        <div className="modal" onClick={stop} role="dialog">
          <div className="modal-title">Agregar servicio</div>
          <div className="form-row">
            <label>Nombre del servicio</label>
            <input type="text" id="srv-nombre" placeholder="Ej: Luz, Internet, Netflix..." />
          </div>
          <div className="grid-2">
            <div className="form-row">
              <label>Monto total</label>
              <input type="text" inputMode="decimal" id="srv-monto" placeholder="0,00" />
            </div>
            <div className="form-row">
              <label>Periodicidad</label>
              <select id="srv-periodo" defaultValue="mensual">
                <option value="mensual">Mensual</option>
                <option value="bimestral">Bimestral</option>
                <option value="anual">Anual</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <label>Fecha de pago</label>
            <input type="date" value={servicioFechaPago} onChange={(e) => setServicioFechaPago(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Quiénes comparten (Personal)</label>
            {state.personal.length > 0 ? (
              <select
                id="srv-personas-select"
                multiple
                title="Ctrl o ⌘ + clic para elegir varias personas"
                aria-label="Personas del equipo que comparten el gasto"
                value={servicioPersonaIds}
                size={Math.min(6, Math.max(3, state.personal.length))}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, (o) => o.value)
                  setServicioPersonaIds(selected)
                }}
                style={{ width: '100%', padding: 8 }}
              >
                {state.personal.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                    {p.puesto ? ` — ${p.puesto}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>No hay personas en Personal. Podés cargar nombres abajo o ir a Personal para dar de alta el equipo.</p>
            )}
          </div>
          <div className="form-row">
            <label>{state.personal.length ? 'Otros nombres (opcional)' : 'Personas que comparten'}</label>
            <input type="text" id="srv-personas-extra" placeholder="Ej: María, Juan (separados por coma)" />
          </div>
          <div className="form-row">
            <label>Día de vencimiento</label>
            <input type="number" id="srv-dia" placeholder="1-31" min={1} max={31} defaultValue={1} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => closeModal('modal-servicio')}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveServicio.isPending}
              onClick={() => saveServicio.mutate({ personaIds: servicioPersonaIds, fechaPago: servicioFechaPago })}
            >
              Guardar
            </button>
          </div>
        </div>,
      )}

      {wrap(
        'modal-personal',
        <div className="modal modal-lg" onClick={stop} role="dialog">
          <div className="modal-title" id="modal-personal-title">
            {editPersonaId ? 'Editar persona' : 'Agregar persona'}
          </div>
          <div className="grid-2">
            <div className="form-row">
              <label>Nombre completo</label>
              <input type="text" id="p-nombre" placeholder="Ej: Lautaro García" value={pNombre} onChange={(e) => setPNombre(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Puesto / Rol</label>
              <input type="text" id="p-puesto" placeholder="Ej: Técnico, Vendedor..." value={pPuesto} onChange={(e) => setPPuesto(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label>Teléfono / WhatsApp</label>
            <input type="text" id="p-tel" placeholder="+54 9 xxx xxx xxxx" value={pTel} onChange={(e) => setPTel(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Email</label>
            <input type="email" id="p-email" placeholder="persona@email.com" value={pEmail} onChange={(e) => setPEmail(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Instagram (usuario)</label>
            <input type="text" id="p-ig" placeholder="@usuario" value={pIg} onChange={(e) => setPIg(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Telegram (usuario)</label>
            <input type="text" id="p-telegram" placeholder="@usuario" value={pTelegram} onChange={(e) => setPTelegram(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Otras plataformas / Link</label>
            <input type="text" id="p-otro" placeholder="Ej: Slack, LinkedIn, Discord..." value={pOtro} onChange={(e) => setPOtro(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Notas</label>
            <textarea id="p-notas" rows={2} placeholder="Observaciones, horarios, etc." value={pNotas} onChange={(e) => setPNotas(e.target.value)} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => closeModal('modal-personal')}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" id="btn-guardar-personal" disabled={savePersona.isPending} onClick={() => savePersona.mutate()}>
              Guardar
            </button>
          </div>
        </div>,
      )}

      {wrap(
        'modal-tarea',
        <div className="modal" onClick={stop} role="dialog">
          <div className="modal-title">Nueva tarea</div>
          <div className="form-row">
            <label>Nombre de la tarea</label>
            <input type="text" id="tarea-nombre" placeholder="Ej: Limpieza general, Atención al cliente..." />
          </div>
          <div className="form-row">
            <label>Descripción (opcional)</label>
            <textarea id="tarea-desc" rows={2} placeholder="Detalles de la tarea..." />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => closeModal('modal-tarea')}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={saveTarea.isPending} onClick={() => saveTarea.mutate()}>
              Agregar tarea
            </button>
          </div>
        </div>,
      )}

      {wrap(
        'modal-email',
        <div className="modal" onClick={stop} role="dialog">
          <div className="modal-title">Redactar correo</div>
          <div className="form-row">
            <label>Para</label>
            <input type="email" id="email-to" placeholder="destinatario@gmail.com" />
          </div>
          <div className="form-row">
            <label>Asunto</label>
            <input type="text" id="email-subject" placeholder="Asunto del correo" />
          </div>
          <div className="form-row">
            <label>Mensaje</label>
            <textarea id="email-body" rows={6} placeholder="Escribe tu mensaje..." />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => closeModal('modal-email')}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={sendEmailMut.isPending} onClick={() => sendEmailMut.mutate()}>
              {sendEmailMut.isPending ? 'Enviando…' : 'Enviar ✉️'}
            </button>
          </div>
        </div>,
      )}

      {wrap(
        'modal-evento',
        <div className="modal" onClick={stop} role="dialog">
          <div className="modal-title" id="modal-evento-title">
            {eventoTipo === 'cliente' ? '⭐ Cliente mensual' : '📌 Nuevo evento único'}
          </div>
          <input type="hidden" id="ev-tipo" value={eventoTipo} readOnly />
          <div className="form-row">
            <label>Título / Nombre del cliente</label>
            <input type="text" id="ev-titulo" placeholder="Nombre del evento o cliente" />
          </div>
          <div id="ev-cliente-fields" style={{ display: eventoTipo === 'cliente' ? 'block' : 'none' }}>
            <div className="form-row">
              <label>Día del mes (recurrente)</label>
              <input type="number" id="ev-dia-mes" placeholder="1-31" min={1} max={31} />
            </div>
            <div className="form-row">
              <label>Descripción del servicio</label>
              <textarea id="ev-cliente-desc" rows={2} placeholder="Qué servicio se le presta..." />
            </div>
            <div className="form-row">
              <label>Monto mensual ($)</label>
              <input type="number" id="ev-monto" placeholder="0.00" />
            </div>
          </div>
          <div id="ev-unico-fields" style={{ display: eventoTipo === 'unico' ? 'block' : 'none' }}>
            <div className="grid-2">
              <div className="form-row">
                <label>Fecha inicio</label>
                <input type="datetime-local" id="ev-inicio" />
              </div>
              <div className="form-row">
                <label>Fecha fin</label>
                <input type="datetime-local" id="ev-fin" />
              </div>
            </div>
            <div className="form-row">
              <label>Descripción</label>
              <textarea id="ev-desc" rows={2} placeholder="Detalles del evento..." />
            </div>
          </div>
          <div className="form-row">
            <label>Color</label>
            <select id="ev-color" defaultValue="#4fffb0">
              <option value="#4fffb0">Verde</option>
              <option value="#7c6fff">Púrpura</option>
              <option value="#ff6b6b">Rojo</option>
              <option value="#ffd166">Dorado</option>
            </select>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => closeModal('modal-evento')}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={saveEvento.isPending} onClick={() => saveEvento.mutate()}>
              Guardar
            </button>
          </div>
        </div>,
      )}
    </>
  )
}
