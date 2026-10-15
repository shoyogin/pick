/** Put text on the clipboard. navigator.clipboard only exists on HTTPS and
 *  localhost, and the NUC serves plain HTTP on its VPN address, so fall back
 *  to the old select-and-copy there. Resolves to whether it worked. */
export async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the fallback */ }
  const box = document.createElement('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  box.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.append(box)
  box.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  box.remove()
  return ok
}
