export default function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={`tab${value === t.value ? ' tab--active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}
