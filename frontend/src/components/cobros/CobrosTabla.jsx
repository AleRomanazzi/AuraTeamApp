import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import RegistrarPago from './RegistrarPago'
import Tag from '../ui/Tag'
import { api } from '../../lib/api'
import { ESTADOS_COBRO, MEDIOS_PAGO, labelDe } from '../../lib/constants'
import { fmt, formatFecha, monthLabel } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { DINERO, invalidar } from '../../lib/queryKeys'
import { linkEmail, linkWhatsApp } from '../../lib/recordatorios'
import { confirmar } from '../../store/confirmStore'

function estadoCobro(c) {
  if (c.vencido) return ESTADOS_COBRO.vencido
  return ESTADOS_COBRO[c.estado] ?? { label: c.estado, tag: '' }
}

function Semaforo({ cobro }) {
  if (cobro.estado === 'pagado') return <span className="semaforo verde" title="Cobrado" />
  if (cobro.estado === 'anulado') return <span className="semaforo gris" title="Anulado" />
  if (cobro.vencido) return <span className="semaforo rojo" title={`Vencido hace ${cobro.dias_vencido} días`} />
  return <span className="semaforo amarillo" title="Pendiente" />
}

export default function CobrosTabla({ cobros, mostrarCliente = true, mostrarPeriodo = false }) {
  const qc = useQueryClient()
  const [pagando, setPagando] = useState(null)

  const accion = useMutation({
    mutationFn: ({ id, tipo }) => (tipo === 'borrar' ? api.delete(`cobros/${id}/`) : api.post(`cobros/${id}/${tipo}/`)),
    onSuccess: (_, { tipo }) => {
      invalidar(qc, DINERO)
      notify({ 'revertir-pago': 'Pago revertido', anular: 'Cobro anulado', borrar: 'Cobro eliminado' }[tipo])
    },
    onError: (e) => notifyError(e),
  })

  const recordar = useMutation({
    mutationFn: (c) => api.post(`cobros/${c.id}/recordar/`),
    onSuccess: (_, c) => {
      invalidar(qc, ['cobros'])
      notify(`Recordatorio enviado a ${c.cliente_email}`)
    },
    onError: (e) => notifyError(e, 'No se pudo enviar el recordatorio'),
  })
  const enviarRecordatorio = async (c) => {
    if (await confirmar({ titulo: `Recordatorio a ${c.cliente_nombre}`, mensaje: `Se envía ahora un email a ${c.cliente_email} desde el Gmail de la agencia con el saldo de ${fmt(c.saldo)}.`, confirmar: 'Enviar' })) {
      recordar.mutate(c)
    }
  }

  const ejecutar = async (c, tipo) => {
    const textos = {
      'revertir-pago': `Se elimina el ingreso de ${fmt(c.monto_cobrado)} y el cobro vuelve a pendiente.`,
      anular: 'El cobro deja de contar como deuda (queda en el historial).',
      borrar: 'Se elimina el cobro definitivamente.',
    }
    if (await confirmar({ titulo: `${c.cliente_nombre} — ${c.concepto}`, mensaje: textos[tipo], peligro: tipo !== 'anular', confirmar: 'Continuar' })) {
      accion.mutate({ id: c.id, tipo })
    }
  }

  return (
    <>
      <div className="table-responsive tabla-apilada">
        <table>
          <thead>
            <tr>
              <th aria-label="Estado" />
              {mostrarCliente ? <th>Cliente</th> : null}
              <th>Concepto</th>
              <th>Vence</th>
              <th className="num">Monto</th>
              <th className="num">Saldo</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cobros.map((c) => {
              const est = estadoCobro(c)
              const abierto = c.estado === 'pendiente' || c.estado === 'parcial'
              return (
                <tr key={c.id} className={c.estado === 'anulado' ? 'row-muted' : ''}>
                  <td className="ocultar-movil">
                    <Semaforo cobro={c} />
                  </td>
                  {mostrarCliente ? (
                    <td className="celda-principal">
                      <Link to={`/clientes/${c.cliente}`} className="cell-title link">
                        <span className="cat-dot" style={{ background: c.cliente_color }} />
                        {c.cliente_nombre}
                      </Link>
                    </td>
                  ) : null}
                  <td className={mostrarCliente ? 'celda-ancha' : 'celda-principal'}>
                    <div className="cell-title">{c.concepto}</div>
                    {mostrarPeriodo ? <div className="cell-sub">{monthLabel(c.periodo)}</div> : null}
                    {abierto && (c.ultimo_recordatorio || c.cliente_recordatorios) ? (
                      <div className="cell-sub">
                        {c.ultimo_recordatorio ? `Recordado el ${formatFecha(c.ultimo_recordatorio, { day: 'numeric', month: 'short' })}` : ''}
                        {c.ultimo_recordatorio && c.cliente_recordatorios ? ' · ' : ''}
                        {c.cliente_recordatorios ? 'recordatorios automáticos' : ''}
                      </div>
                    ) : null}
                    {c.fecha_pago ? (
                      <div className="cell-sub">
                        Pagó {formatFecha(c.fecha_pago, { day: 'numeric', month: 'short' })}
                        {c.medio_pago ? ` · ${labelDe(MEDIOS_PAGO, c.medio_pago)}` : ''}
                        {c.comprobante ? ` · ${c.comprobante}` : ''}
                      </div>
                    ) : null}
                  </td>
                  <td className="nowrap" data-label="Vence">
                    {formatFecha(c.vencimiento, { day: 'numeric', month: 'short' })}
                    {c.vencido ? <div className="cell-sub down">hace {c.dias_vencido} d</div> : null}
                  </td>
                  <td className="num mono nowrap" data-label="Monto">
                    {fmt(c.monto)}
                  </td>
                  <td className={`num mono nowrap ${abierto ? (c.vencido ? 'down' : '') : 'muted'}`} data-label="Saldo">
                    {fmt(c.saldo)}
                  </td>
                  <td data-label="Estado">
                    <Tag color={est.tag}>{est.label}</Tag>
                  </td>
                  <td className="nowrap actions-cell">
                    {abierto ? (
                      <>
                        <button type="button" className="btn btn-primary btn-xs" onClick={() => setPagando(c)}>
                          Registrar pago
                        </button>
                        <a className="btn btn-secondary btn-xs" href={linkWhatsApp(c)} target="_blank" rel="noreferrer" title="Recordatorio por WhatsApp">
                          WhatsApp
                        </a>
                        {c.cliente_email ? (
                          <button type="button" className="btn btn-secondary btn-xs" disabled={recordar.isPending} onClick={() => enviarRecordatorio(c)} title="Enviar recordatorio ahora por email (Gmail de la agencia)">
                            ✉ Recordar
                          </button>
                        ) : (
                          <a className="btn btn-secondary btn-xs" href={linkEmail(c)} title="Recordatorio por email (el cliente no tiene email cargado)">
                            ✉
                          </a>
                        )}
                      </>
                    ) : null}
                    <details className="menu">
                      <summary className="btn btn-secondary btn-xs" aria-label="Más acciones">
                        ⋯
                      </summary>
                      <div className="menu-list">
                        {Number(c.monto_cobrado) > 0 ? (
                          <button type="button" onClick={() => ejecutar(c, 'revertir-pago')}>
                            Revertir pago
                          </button>
                        ) : null}
                        {abierto && Number(c.monto_cobrado) === 0 ? (
                          <button type="button" onClick={() => ejecutar(c, 'anular')}>
                            Anular
                          </button>
                        ) : null}
                        {Number(c.monto_cobrado) === 0 ? (
                          <button type="button" className="down" onClick={() => ejecutar(c, 'borrar')}>
                            Eliminar
                          </button>
                        ) : null}
                      </div>
                    </details>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pagando ? <RegistrarPago cobro={pagando} onClose={() => setPagando(null)} /> : null}
    </>
  )
}
