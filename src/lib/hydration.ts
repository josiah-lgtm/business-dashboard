// First-load hydration gate.
//
// A fresh TEAM-build browser (VITE_WORKSPACE_KEY set) boots with EMPTY local
// state (see makeInitialState) and only fills in once the first cloudPull()
// resolves over the network. Without a gate the user briefly sees every view's
// "No data yet / zeros" empty state, then it pops to real numbers — which reads
// as broken. This flag lets the shell show a loading skeleton for exactly that
// window instead.
//
// It is set ONCE at boot, BEFORE cloudPull() mutates state, and only when the
// local state is genuinely empty. Solo/keyless builds and returning teammates
// (warm localStorage) never set it, so their instant render is untouched — no
// skeleton flash on a fast/cached load.
import { ref } from 'vue'
import type { State } from '@/types'
import { cloudIsEnabled } from './cloud'

export const cloudFirstLoadPending = ref(false)

export function computeInitialHydrating(state: State): void {
  try {
    const empty =
      (!state.expenses || state.expenses.length === 0) &&
      Object.keys(state.months || {}).length <= 1 &&
      (!state.revenueEntries || state.revenueEntries.length === 0)
    cloudFirstLoadPending.value = cloudIsEnabled() && empty
  } catch {
    cloudFirstLoadPending.value = false
  }
}

export function finishHydration(): void {
  cloudFirstLoadPending.value = false
}
