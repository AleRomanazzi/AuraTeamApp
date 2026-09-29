import { currentMonth, monthLabel, shiftMonth } from '../../lib/format'

export default function MonthPicker({ value, onChange }) {
  return (
    <div className="month-picker">
      <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes anterior" onClick={() => onChange(shiftMonth(value, -1))}>
        ‹
      </button>
      <span className="month-picker-label">{monthLabel(value)}</span>
      <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes siguiente" onClick={() => onChange(shiftMonth(value, 1))}>
        ›
      </button>
      {value !== currentMonth() ? (
        <button type="button" className="btn btn-secondary btn-xs" onClick={() => onChange(currentMonth())}>
          Hoy
        </button>
      ) : null}
    </div>
  )
}
