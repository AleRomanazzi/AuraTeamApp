import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({ open = true, onClose, title, size, children, footer, onSubmit }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return undefined
    const previo = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => {
      const primero = ref.current?.querySelector('input:not([type=hidden]), select, textarea, button')
      primero?.focus()
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      previo?.focus?.()
    }
  }, [open, onClose])

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
