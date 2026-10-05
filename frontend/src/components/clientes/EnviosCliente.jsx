import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getList } from '../../lib/api'
import { currentMonth, formatFechaHora, monthLabel, shiftMonth } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { QK, invalidar } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'
import Modal from '../ui/Modal'
import QueryState from '../ui/QueryState'
import Tag from '../ui/Tag'

const ESTADOS = { borrador: ['Borrador', 'yellow'], enviado: ['Enviado', 'green'], error: ['Error', 'red'], descartado: ['Descartado', ''] }
const TIPOS = { reporte: '📄 Reporte', recordatorio: '💵 Recordatorio' }

function useAccionesEnvio(onHecho) {
  const qc = useQueryClient()
  const enviar = useMutation({
    mutationFn: (e) => api.post(`envios/${e.id}/enviar/`),
    onSuccess: () => {
      invalidar(qc, ['envios', 'cobros'])
      notify('Email enviado')
      onHecho?.()
    },
    onError: (e) => notifyError(e, 'No se pudo enviar'),
  })
  const descartar = useMutation({
    mutationFn: (e) => api.post(`envios/${e.id}/descartar/`),
    onSuccess: () => {
      invalidar(qc, ['envios'])
      onHecho?.()
    },
    onError: (e) => notifyError(e),
  })
  const confirmarEnvio = async (e, para) => {
    if (await confirmar({ titulo: 'Enviar al cliente', mensaje: `Se envía «${e.asunto}» a ${para || 'el email del cliente'} desde el Gmail de la agencia.`, confirmar: 'Enviar' })) enviar.mutate(e)
  }
  return { enviar, descartar, confirmarEnvio }
}

export function EnvioPreview({ envioId, onClose }) {
  const q = useQuery({ queryKey: QK.envio(envioId), queryFn: () => api.get(`envios/${envioId}/`).then((r) => r.data) })
  const { enviar, descartar, confirmarEnvio } = useAccionesEnvio(onClose)
  const e = q.data
  const pendiente = e && e.estado !== 'enviado'
  return (
    <Modal
      title={e ? e.asunto : 'Vista previa'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {e?.error ? <span className="small down">{e.error}</span> : null}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          {pendiente && e.estado !== 'descartado' ? (
            <button type="button" className="btn btn-secondary" disabled={descartar.isPending} onClick={() => descartar.mutate(e)}>
              Descartar
            </button>
          ) : null}
          {pendiente ? (
            <button type="button" className="btn btn-primary" disabled={enviar.isPending} onClick={() => confirmarEnvio(e, e.para)}>
              {enviar.isPending ? 'Enviando…' : 'Enviar'}
            </button>
          ) : null}
        </>
      }
    >
      <QueryState query={q}>{(d) => <iframe title="Vista previa del email" className="email-preview" srcDoc={d.html} sandbox="" />}</QueryState>
    </Modal>
  )
}

function FilaEnvio({ e, mostrarCliente, onVer }) {
  const [label, color] = ESTADOS[e.estado] ?? [e.estado, '']
  return (
    <div className="list-row">
      <div className="list-row-main">
        <button type="button" className="link-btn list-row-title" onClick={onVer}>
          {TIPOS[e.tipo]} · {mostrarCliente ? `${e.cliente_nombre} · ` : ''}
          {e.tipo === 'reporte' ? monthLabel(e.periodo) : e.asunto.replace(' · AuraTeam', '')}
        </button>
        <div className="list-row-sub">
          {e.enviado_en ? `Enviado ${formatFechaHora(e.enviado_en)}${e.enviado_por_nombre ? ` por ${e.enviado_por_nombre}` : ' (automático)'}` : `Creado ${formatFechaHora(e.creado)}`}
          {e.error ? <span className="down"> · {e.error}</span> : null}
        </div>
      </div>
      <Tag color={color}>{label}</Tag>
    </div>
  )
}

export default function EnviosCliente({ clienteId, email }) {
  const qc = useQueryClient()
  const [viendo, setViendo] = useState(null)
  const anterior = shiftMonth(currentMonth(), -1)
  const params = { cliente: clienteId }
  const q = useQuery({ queryKey: QK.envios(params), queryFn: () => getList('envios/', params) })
  const preparar = useMutation({
    mutationFn: () => api.post(`clientes/${clienteId}/reporte-email/`, { mes: anterior }).then((r) => r.data),
    onSuccess: (d) => {
      invalidar(qc, ['envios'])
      setViendo(d.id)
    },
    onError: (e) => notifyError(e, 'No se pudo armar el reporte'),
  })
  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" /> Emails al cliente
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={preparar.isPending} onClick={() => preparar.mutate()}>
          📄 Reporte de {monthLabel(anterior, { month: 'long' })}
        </button>
      </div>
      {!email ? <div className="info-box down">El cliente no tiene email cargado: los reportes y recordatorios no se pueden enviar.</div> : null}
      <QueryState query={q} vacio="Todavía no se le enviaron emails.">
        {(lista) => lista.map((e) => <FilaEnvio key={e.id} e={e} onVer={() => setViendo(e.id)} />)}
      </QueryState>
      {viendo ? <EnvioPreview envioId={viendo} onClose={() => setViendo(null)} /> : null}
    </div>
  )
}

export function ReportesPendientes() {
  const [viendo, setViendo] = useState(null)
  const params = { estado: 'borrador' }
  const q = useQuery({ queryKey: QK.envios(params), queryFn: () => getList('envios/', params) })
  if (!q.data?.length) return null
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">
        <span className="dot" style={{ background: 'var(--gold)' }} /> Reportes para revisar y enviar
      </div>
      {q.data.map((e) => (
        <div key={e.id} className="list-row">
          <div className="list-row-main">
            <Link to={`/clientes/${e.cliente}?tab=emails`} className="list-row-title">
              {e.cliente_nombre}
            </Link>
            <div className="list-row-sub">{e.tipo === 'reporte' ? `Reporte de ${monthLabel(e.periodo)}` : e.asunto}</div>
          </div>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => setViendo(e.id)}>
            Vista previa
          </button>
        </div>
      ))}
      {viendo ? <EnvioPreview envioId={viendo} onClose={() => setViendo(null)} /> : null}
    </div>
  )
}
