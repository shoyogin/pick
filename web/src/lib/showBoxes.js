import { useCallback, useEffect, useState } from 'react'

const KEY = 'showBoxes'

/** Whether the overlays are drawn, remembered per browser and shared by Review
 *  and Fix. `b` toggles from anywhere, so it works without reaching for the
 *  toolbar while judging a run of images. */
export function useShowBoxes() {
  const [on, setOn] = useState(() => localStorage.getItem(KEY) !== 'off')

  const toggle = useCallback(() => {
    setOn((v) => {
      localStorage.setItem(KEY, v ? 'off' : 'on')
      return !v
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'b' || e.metaKey || e.ctrlKey) return
      if (e.target.matches('textarea, input')) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return [on, toggle]
}
