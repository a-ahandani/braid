export function Splitter({ onDrag }: { onDrag: (dx: number) => void }) {
  return (
    <div
      class="splitter"
      onPointerDown={(e) => {
        e.preventDefault()
        let last = e.clientX
        const move = (ev: PointerEvent) => {
          onDrag(ev.clientX - last)
          last = ev.clientX
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          document.body.style.cursor = ''
        }
        document.body.style.cursor = 'col-resize'
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}
