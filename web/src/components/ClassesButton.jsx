import { useEffect, useRef, useState } from 'react'
import { classColor, resolvedColor } from '../lib/colors'

/**
 * Toolbar control for which classes are drawn and in what colour.
 *
 * Both live here because they answer the same question — "let me see this one
 * clearly" — and splitting them across two menus would mean hunting.
 */
export default function ClassesButton({ classes, prefs, btn, btnOn }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)

  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const { hiddenIdx, toggle, showAll, hideAll, setColor, resetColors,
          anyHidden, customised } = prefs
  const shown = classes.length - hiddenIdx.size

  return (
    <span ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Which classes to draw, and in what colour (b hides them all)"
        className={anyHidden ? btnOn : btn}
      >
        Boxes {anyHidden && <span className="num">{shown}/{classes.length}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-20 w-60 rounded-md border border-line bg-surface p-2 text-[11px] shadow-lg">
          <div className="mb-1.5 flex gap-1">
            <button onClick={showAll} className={`flex-1 ${btn}`}>Show all</button>
            <button onClick={hideAll} className={`flex-1 ${btn}`}>Hide all</button>
          </div>

          <ul className="max-h-64 overflow-y-auto">
            {classes.map((name, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-hover">
                  <input
                    type="checkbox" checked={!hiddenIdx.has(i)}
                    onChange={() => toggle(i)} className="size-3.5 accent-brand"
                  />
                  {/* the swatch is the picker: the colour you see is the control */}
                  <span className="relative size-3.5 shrink-0 rounded-[2px]"
                        style={{ background: classColor(i) }}>
                    <input
                      type="color" value={resolvedColor(i)}
                      onChange={(e) => setColor(i, e.target.value)}
                      title={`Colour for ${name}`}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                </label>
              </li>
            ))}
          </ul>

          {customised && (
            <button onClick={resetColors} className={`mt-1.5 w-full ${btn}`}>
              Reset colours
            </button>
          )}
        </div>
      )}
    </span>
  )
}
