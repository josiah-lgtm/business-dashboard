// Bridges the ported utility functions (money/fx/calc) to the live reactive
// state, the same way the legacy code read a module-global `state`.
// The store binds the reactive object here on creation; reads inside Vue
// computeds/render stay reactive because the object is a Pinia/reactive proxy.
import type { State } from '@/types'

let _state: State

export function bindState(s: State) {
  _state = s
}

export function S(): State {
  return _state
}
