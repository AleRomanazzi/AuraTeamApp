import { useState } from 'react'
import { normalizarMonto } from '../../lib/money'

function mostrar(valor) {
  if (valor === '' || valor === null || valor === undefined) return ''
  const n = Number(valor)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/**
 * Input de pesos: acepta "150.000" o "150000,50" y entrega "150000.5" (punto decimal) a `onChange`.
 */
export default function MoneyInput({ value, onChange, placeholder = '0', required, id, disabled, autoFocus }) {
  const [borrador, setBorrador] = useState(null)
  return (
    <div className="money-input">
      <span aria-hidden>$</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        value={borrador ?? mostrar(value)}
        onFocus={() => setBorrador(value === '' || value == null ? '' : String(value).replace('.', ','))}
        onChange={(e) => {
          setBorrador(e.target.value)
          onChange(normalizarMonto(e.target.value))
        }}
        onBlur={() => setBorrador(null)}
      />
    </div>
  )
}
