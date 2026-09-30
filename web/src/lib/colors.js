/* Class hues are CSS variables, not literals, so they follow the light/dark
   switch with no React state involved: an inline `background: var(--color-cls-3)`
   just re-resolves when the theme attribute changes.

   Each class asks for its own variable first and falls back to the shared
   palette slot, so one `--cls-3` on :root recolours class 3 everywhere — boxes,
   swatches, donut slices — with no component knowing it happened.

   The palette order is fixed and validated for colour-blind separation in both
   themes (worst adjacent ΔE 9.1 light, 8.4 dark). Colour follows the class
   INDEX, never its rank, so a class keeps its hue for the life of the dataset.

   Past eight classes the hues repeat. That is fine: the class name is printed
   on every box, slice and table row, so identity never rests on colour alone. */
export const CLASS_SLOTS = 8

const slot = (i) => (((i % CLASS_SLOTS) + CLASS_SLOTS) % CLASS_SLOTS) + 1

export const classColor = (i) => `var(--cls-${i}, var(--color-cls-${slot(i)}))`
export const classInk = (i) => `var(--cls-ink-${i}, var(--color-cls-ink-${slot(i)}))`

// "Other" slices and unfilled tracks — present, but never mistaken for data.
export const GREY = 'var(--color-neutral)'

/** Black or white, whichever reads on `hex`. A chosen colour is a literal, so
 *  its label cannot lean on a token that flips with the theme. */
export function inkFor(hex) {
  const v = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return (L + 0.05) / 0.05 > (1.05) / (L + 0.05) ? '#0b0b0b' : '#ffffff'
}

/** The colour a class is actually drawn in, as a hex an <input type="color">
 *  can show — the palette token resolved against the live theme. */
export function resolvedColor(i) {
  const css = getComputedStyle(document.documentElement)
  const own = css.getPropertyValue(`--cls-${i}`).trim()
  if (own) return own
  const token = css.getPropertyValue(`--color-cls-${slot(i)}`).trim()
  return token || '#888888'
}
