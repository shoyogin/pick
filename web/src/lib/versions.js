/** Versions come back as paths under the dataset root — `v1` on a flat root,
 *  `online/t0.0.0` on a grouped one. Group them by the folder they sit in so
 *  the dropdown reads as a list of versions rather than a list of paths. */
export function byGroup(versions) {
  const groups = new Map()
  for (const v of versions) {
    const cut = v.lastIndexOf('/')
    const key = cut < 0 ? '' : v.slice(0, cut)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ value: v, label: cut < 0 ? v : v.slice(cut + 1) })
  }
  return [...groups]
}
