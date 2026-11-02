/**
 * Copies text during the tap, the same way selecting it by hand does.
 *
 * This page used `navigator.clipboard.writeText` and handled the rejection by
 * clearing its own "Copied" flag, so a refusal was indistinguishable from
 * nothing happening — the button looked dead and the string had to be
 * highlighted by hand. Two separate things go wrong with that call here:
 *
 * - `navigator.clipboard` is undefined outside a secure context, so the
 *   property access THROWS inside the click handler rather than rejecting.
 *   React does not catch that, so neither branch of the `.then` ever runs.
 * - Even where it exists, the write is awaited, and by the time the promise
 *   settles the browser no longer counts the click as user activation.
 *
 * So the selection has to happen synchronously, before the click ends.
 * `execCommand("copy")` needs no permission and no secure context, which is
 * why it is the primary path here rather than a fallback.
 *
 * This is a deliberate duplicate of `copyText` in the storefront's
 * `studio-admin-logic.ts`, which fixed the same bug on the other admin
 * surface. The two live in different build trees and cannot import each
 * other; keep them in step by hand.
 *
 * Returns whether the copy actually happened, so the caller can say so
 * instead of claiming success it cannot observe.
 */
export function copyText(value: string, doc: Document = document): boolean {
  if (value.length === 0) return false
  const area = doc.createElement("textarea")
  area.value = value
  area.style.position = "fixed"
  area.style.top = "0"
  area.style.left = "0"
  area.style.opacity = "0"
  // 16px or iOS zooms the page when the textarea takes focus.
  area.style.fontSize = "16px"
  doc.body.appendChild(area)
  area.contentEditable = "true"
  area.readOnly = false
  const range = doc.createRange()
  range.selectNodeContents(area)
  const selection = doc.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(range)
  }
  area.setSelectionRange(0, value.length)
  let copied = false
  try {
    copied = doc.execCommand("copy")
  } catch {
    copied = false
  }
  doc.body.removeChild(area)
  return copied
}
