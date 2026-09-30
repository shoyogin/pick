import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { inkFor } from './colors'

const COLORS = 'classColors'
const HIDDEN = 'hiddenClasses'

/** Preferences are keyed by class NAME, not index: "car" keeps its colour
 *  across versions, which is how people think about it. An unnamed class falls
 *  back to its index. */
const keyOf = (classes, i) => classes[i] || `#${i}`

const read = (k) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } }

/**
 * Per-class colour overrides and per-class visibility, for one version's list
 * of class names.
 *
 * Colours are pushed to :root as `--cls-<i>` / `--cls-ink-<i>`, which every
 * `classColor()` call already prefers over the palette token — so a change
 * repaints boxes, swatches and charts without a single component re-rendering
 * on its account.
 */
export function useClassPrefs(classes) {
  const [colors, setColors] = useState(() => read(COLORS) || {})
  const [hidden, setHidden] = useState(() => new Set(Object.keys(read(HIDDEN) || {})))

  useEffect(() => {
    const root = document.documentElement
    classes.forEach((_, i) => {
      const hex = colors[keyOf(classes, i)]
      if (hex) {
        root.style.setProperty(`--cls-${i}`, hex)
        root.style.setProperty(`--cls-ink-${i}`, inkFor(hex))
      } else {
        root.style.removeProperty(`--cls-${i}`)
        root.style.removeProperty(`--cls-ink-${i}`)
      }
    })
  }, [classes, colors])

  // Indices, since that is what a box carries. Rebuilt when either side moves.
  const hiddenIdx = useMemo(() => {
    const out = new Set()
    classes.forEach((_, i) => { if (hidden.has(keyOf(classes, i))) out.add(i) })
    return out
  }, [classes, hidden])

  const setColor = useCallback((i, hex) => {
    setColors((c) => {
      const next = { ...c, [keyOf(classes, i)]: hex }
      write(COLORS, next)
      return next
    })
  }, [classes])

  const resetColors = useCallback(() => {
    setColors(() => { write(COLORS, {}); return {} })
  }, [])

  const toggle = useCallback((i) => {
    setHidden((h) => {
      const next = new Set(h)
      const k = keyOf(classes, i)
      next.has(k) ? next.delete(k) : next.add(k)
      write(HIDDEN, Object.fromEntries([...next].map((x) => [x, 1])))
      return next
    })
  }, [classes])

  const showAll = useCallback(() => {
    setHidden(() => { write(HIDDEN, {}); return new Set() })
  }, [])

  const hideAll = useCallback(() => {
    setHidden(() => {
      const next = new Set(classes.map((_, i) => keyOf(classes, i)))
      write(HIDDEN, Object.fromEntries([...next].map((x) => [x, 1])))
      return next
    })
  }, [classes])

  // `b` clears the picture and puts it back. It restores the selection you had
  // rather than showing everything: a peek should not undo your filtering.
  const before = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'b' || e.metaKey || e.ctrlKey) return
      if (e.target.matches('textarea, input')) return
      e.preventDefault()
      setHidden((h) => {
        const all = classes.map((_, i) => keyOf(classes, i))
        let next
        if (h.size === all.length && all.length > 0) {
          next = before.current ?? new Set()
          before.current = null
        } else {
          before.current = h
          next = new Set(all)
        }
        write(HIDDEN, Object.fromEntries([...next].map((x) => [x, 1])))
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [classes])

  return {
    hiddenIdx, setColor, resetColors, toggle, showAll, hideAll,
    anyHidden: hiddenIdx.size > 0,
    allHidden: classes.length > 0 && hiddenIdx.size === classes.length,
    customised: Object.keys(colors).length > 0,
  }
}
