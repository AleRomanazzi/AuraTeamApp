import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({ open = true, onClose, title, size, children, footer, onSubmit }) {
  const ref = useRef(null)
  const titleId = useId()
  const alCerrar = useRef(onClose)
  useEffect(() => {
    alCerrar.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined
    const previo = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') alCerrar.current?.()
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => {
      const raiz = ref.current
      if (!raiz || raiz.contains(document.activeElement)) return
      const campo = raiz.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
      const boton = raiz.querySelector('button:not(.modal-close):not([disabled])')
      ;(campo || boton)?.focus()
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      if (previo instanceof HTMLElement) previo.focus()
    }
  }, [open])

  if (!open) return null

  const contenido = (
    <>
      <div className="modal-head">
        <h3 className="modal-title" id={titleId}>
          {title}
        </h3>
        <button type="button" className="modal-close" aria-label="Cerrar" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </>
  )

  return createPortal(
    <div className="modal-overlay open" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={`modal${size === 'lg' ? ' modal-lg' : ''}${size === 'xl' ? ' modal-xl' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {onSubmit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit(e)
            }}
          >
            {contenido}
          </form>
        ) : (
          contenido
        )}
      </div>
    </div>,
    document.body,
  )
}
