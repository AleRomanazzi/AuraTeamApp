export default function ProgressBar({ valor, color = 'var(--accent)', etiqueta }) {
  const pct = Math.max(0, Math.min(100, Number(valor) || 0))
  return (
    <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={etiqueta}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}
