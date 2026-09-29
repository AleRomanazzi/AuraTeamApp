import { fmt, formatFecha, monthLabel } from './format'

function textoRecordatorio(cobro) {
  const saldo = Number(cobro.saldo ?? cobro.monto)
  const vencio = cobro.vencido
  return [
    `Hola ${cobro.cliente_nombre}! ¿Cómo va?`,
    vencio
      ? `Te escribimos de Aura Team para recordarte que quedó pendiente el pago de ${cobro.concepto} (${monthLabel(cobro.periodo)}) por ${fmt(saldo)}, que venció el ${formatFecha(cobro.vencimiento)}.`
      : `Te recordamos que el ${formatFecha(cobro.vencimiento)} vence el pago de ${cobro.concepto} (${monthLabel(cobro.periodo)}) por ${fmt(saldo)}.`,
    'Cuando lo abones, si podés mandanos el comprobante. ¡Gracias!',
  ].join('\n\n')
}

export function linkWhatsApp(cobro) {
  const numero = String(cobro.cliente_whatsapp || '').replace(/\D/g, '')
  const texto = encodeURIComponent(textoRecordatorio(cobro))
  return numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`
}

export function linkEmail(cobro) {
  const asunto = encodeURIComponent(`Recordatorio de pago — ${cobro.concepto} (${monthLabel(cobro.periodo)})`)
  const cuerpo = encodeURIComponent(textoRecordatorio(cobro))
  return `mailto:${cobro.cliente_email || ''}?subject=${asunto}&body=${cuerpo}`
}
