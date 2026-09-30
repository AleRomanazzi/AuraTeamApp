import { notify } from '../../lib/notify'

export default function CopyField({ valor, etiqueta }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor)
      notify(`${etiqueta || 'Valor'} copiado`)
    } catch {
      notify('No se pudo copiar: seleccionalo y copialo a mano', 'error')
    }
  }
  return (
    <div className="copy-field">
      <code title={valor}>{valor}</code>
      <button type="button" className="btn btn-secondary btn-xs" onClick={copiar} aria-label={`Copiar ${etiqueta || 'valor'}`}>
        Copiar
      </button>
    </div>
  )
}
