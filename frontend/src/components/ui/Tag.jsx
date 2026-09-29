export default function Tag({ color, children, title }) {
  return (
    <span className={`tag${color ? ` tag-${color}` : ' tag-neutral'}`} title={title}>
      {children}
    </span>
  )
}
