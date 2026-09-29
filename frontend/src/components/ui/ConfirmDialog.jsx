import { useState } from 'react'
import { useConfirmStore } from '../../store/confirmStore'
import Modal from './Modal'

function Dialogo({ pedido, onFin }) {
  const [texto, setTexto] = useState('')
  const bloqueado = Boolean(pedido.escribir) && texto.trim() !== pedido.escribir
  const responder = (ok) => {
    pedido.resolve(ok)
    onFin()
  }
  return (
    <Modal
      title={pedido.titulo || '¿Confirmás?'}
      onClose={() => responder(false)}
      onSubmit={() => !bloqueado && responder(true)}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => responder(false)}>
            Cancelar
          </button>
          <button type="submit" className={`btn ${pedido.peligro ? 'btn-danger' : 'btn-primary'}`} disabled={bloqueado}>
            {pedido.confirmar || 'Confirmar'}
          </button>
        </>
      }
    >
      <p className="confirm-text">{pedido.mensaje}</p>
      {pedido.escribir ? (
        <div className="form-row" style={{ marginTop: 16 }}>
          <label htmlFor="confirm-escribir">
            Escribí <strong>{pedido.escribir}</strong> para confirmar
          </label>
          <input id="confirm-escribir" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" />
        </div>
      ) : null}
    </Modal>
  )
}

export default function ConfirmDialog() {
  const pedido = useConfirmStore((s) => s.pedido)
  const cerrar = useConfirmStore((s) => s.cerrar)
  if (!pedido) return null
  return <Dialogo key={pedido.mensaje + (pedido.titulo || '')} pedido={pedido} onFin={cerrar} />
}
