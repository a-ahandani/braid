import { useEffect, useRef } from 'preact/hooks'

export interface MenuItem {
  label?: string
  danger?: boolean
  sep?: boolean
  onClick?: () => void
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function Menu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > innerWidth) el.style.left = `${Math.max(0, innerWidth - r.width - 4)}px`
    if (r.bottom > innerHeight) el.style.top = `${Math.max(0, innerHeight - r.height - 4)}px`
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && el.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', onClose)
    }
  }, [menu, onClose])
  return (
    <div class="menu" ref={ref} style={{ left: `${menu.x}px`, top: `${menu.y}px` }}>
      {menu.items.map((it, i) =>
        it.sep ? (
          <div class="sep" key={i} />
        ) : (
          <button
            key={i}
            class={it.danger ? 'danger' : ''}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
