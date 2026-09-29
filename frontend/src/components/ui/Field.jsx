import { cloneElement, isValidElement, useId } from 'react'

export default function Field({ label, hint, children, className = '' }) {
  const id = useId()
  const hijo = isValidElement(children) && !children.props.id ? cloneElement(children, { id }) : children
  const htmlFor = isValidElement(children) ? children.props.id || id : undefined
  return (
    <div className={`form-row ${className}`}>
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {hijo}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  )
}
