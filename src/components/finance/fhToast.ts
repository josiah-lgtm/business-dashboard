// Tiny ephemeral toast at bottom-center — ported from legacy fhToast.
// Imperatively manages a single DOM node so any component can fire feedback.
let timer: ReturnType<typeof setTimeout> | undefined

export function fhToast(msg: string): void {
  let t = document.getElementById('fh-toast')
  if (!t) {
    t = document.createElement('div')
    t.id = 'fh-toast'
    t.className = 'fh-toast'
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(timer)
  timer = setTimeout(() => t && t.classList.remove('show'), 2400)
}
