import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const STEP = 1.3
const MAX_NATURAL = 8      // never past 8 image pixels per screen pixel

/**
 * Scrollable stage that sizes its child in pixels instead of scaling it.
 *
 * The child's boxes are positioned in percentages, so they follow the frame for
 * free, while borders, class tags and editor handles keep their CSS pixel size
 * — a `transform: scale()` would blow those up with the image.
 *
 * Pan is native scroll: dragging belongs to the editor underneath.
 */
export default function ZoomPane({ dim, resetKey, toolbarExtra, children }) {
  const pane = useRef(null)
  const [box, setBox] = useState(null)
  const [zoom, setZoom] = useState(1)      // 1 = fits the pane
  const pending = useRef(null)

  useEffect(() => {
    const el = pane.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setBox({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { setZoom(1) }, [resetKey])

  const ratio = dim ? dim[0] / dim[1] : 4 / 3
  let fit = null
  if (box && box.width > 0 && box.height > 0) {
    const w = Math.min(box.width, box.height * ratio)
    fit = { width: w, height: w / ratio }
  }
  // Scale at fit, in image pixels per screen pixel. Everything else is derived
  // from it so the readout can speak in natural size, which is what "is this
  // box a few pixels off?" is actually asking.
  const atFit = fit && dim ? fit.width / dim[0] : 1
  const min = Math.min(1, 1 / atFit)
  const max = Math.max(1, MAX_NATURAL / atFit)
  const clamp = useCallback((z) => Math.min(Math.max(z, min), max), [min, max])
  const frame = fit ? { width: fit.width * zoom, height: fit.height * zoom } : null
  const pct = frame && dim ? Math.round((frame.width / dim[0]) * 100) : 100

  // Keep the point under the cursor still: remember where it was, then put the
  // scroll offset back after the frame has resized.
  const zoomAt = useCallback((next, px, py) => {
    const el = pane.current
    if (!el) return
    const z = clamp(next)
    setZoom((prev) => {
      if (z === prev) return prev
      pending.current = {
        k: z / prev,
        cx: el.scrollLeft + px, cy: el.scrollTop + py, px, py,
      }
      return z
    })
  }, [clamp])

  useLayoutEffect(() => {
    const p = pending.current
    const el = pane.current
    if (!p || !el) return
    pending.current = null
    el.scrollLeft = p.cx * p.k - p.px
    el.scrollTop = p.cy * p.k - p.py
  }, [zoom])

  // Native listener: React's onWheel cannot preventDefault reliably, and
  // without that the page scrolls instead of the image zooming.
  useEffect(() => {
    const el = pane.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(zoom * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, zoomAt])

  const centre = useCallback((z) => {
    const el = pane.current
    zoomAt(z, (el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2)
  }, [zoomAt])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('textarea, input') || e.metaKey || e.ctrlKey) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); centre(zoom * STEP) }
      if (e.key === '-') { e.preventDefault(); centre(zoom / STEP) }
      if (e.key === '0') { e.preventDefault(); setZoom(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, centre])

  const btn = 'rounded border border-rule bg-card px-1.5 py-0.5 hover:bg-hover disabled:opacity-40'

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-stage">
      <div ref={pane} className="size-full overflow-auto">
        {/* m-auto centres while it fits and collapses to 0 once it does not.
            justify-center would split the overflow across both sides, and the
            half above and left of the origin cannot be scrolled to. */}
        <div className="flex min-h-full w-max min-w-full p-2">
          <div className="m-auto">{frame && children(frame)}</div>
        </div>
      </div>

      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-line bg-surface/90 px-1.5 py-1 text-[11px] backdrop-blur">
        <button onClick={() => centre(zoom / STEP)} disabled={zoom <= min}
                title="Zoom out (-)" className={btn}>−</button>
        <span className="num w-10 text-center text-ink2" title="of natural size">{pct}%</span>
        <button onClick={() => centre(zoom * STEP)} disabled={zoom >= max}
                title="Zoom in (+)" className={btn}>+</button>
        <button onClick={() => setZoom(1)} title="Fit to pane (0)" className={btn}>Fit</button>
        <button onClick={() => centre(1 / atFit)} title="One image pixel per screen pixel"
                className={btn}>1:1</button>
        {toolbarExtra}
      </div>
    </div>
  )
}
