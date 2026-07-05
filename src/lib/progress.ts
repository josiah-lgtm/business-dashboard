// A tiny top-of-page progress bar model (NProgress-style). Reactive width/active
// that a component renders. Driven from the one genuinely-async operation that
// can take a moment: cloud sync (pull/push). It trickles toward 90% while active
// and snaps to 100% on completion, then fades out.
import { reactive } from 'vue'

export const progress = reactive<{ active: boolean; width: number }>({ active: false, width: 0 })

let trickle: ReturnType<typeof setInterval> | null = null
let fadeOut: ReturnType<typeof setTimeout> | null = null
let depth = 0 // number of overlapping in-flight tasks

function clearTrickle() {
  if (trickle) {
    clearInterval(trickle)
    trickle = null
  }
}

export function startProgress() {
  depth++
  if (fadeOut) {
    clearTimeout(fadeOut)
    fadeOut = null
  }
  progress.active = true
  if (progress.width < 8) progress.width = 8
  if (!trickle) {
    trickle = setInterval(() => {
      const remaining = 90 - progress.width
      if (remaining > 0) progress.width += Math.max(0.5, remaining * 0.08)
    }, 220)
  }
}

export function doneProgress() {
  if (depth === 0) return // nothing was started — don't flash the bar
  depth--
  if (depth > 0) return // still other tasks in flight
  clearTrickle()
  progress.width = 100
  fadeOut = setTimeout(() => {
    progress.active = false
    progress.width = 0
    fadeOut = null
  }, 260)
}
