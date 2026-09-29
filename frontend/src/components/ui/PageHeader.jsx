export default function PageHeader({ titulo, subtitulo, children }) {
  return (
    <div className="section-header">
      <div>
        <h2>{titulo}</h2>
        {subtitulo ? <p>{subtitulo}</p> : null}
      </div>
      {children ? <div className="header-actions">{children}</div> : null}
    </div>
  )
}
