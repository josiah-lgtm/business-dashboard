import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router, NAV_ITEMS } from './router'
import { useDashboard } from './stores/dashboard'
import { cloudIsEnabled, cloudPull, cloudStartPolling, cloudStartEventStream, setCloudStatus } from './lib/cloud'
import { computeInitialHydrating, finishHydration } from './lib/hydration'
import './assets/app.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// Instantiate the store now so loadState() + the persistence watch + cloud
// hooks are live before first render.
const store = useDashboard()

// Decide the first-load skeleton BEFORE any cloud pull mutates state: only a
// fresh, empty team build waits on the network; everyone else renders instantly.
computeInitialHydrating(store.state)

app.use(router)

// Keep persisted state.meta.activeView in sync with the route, and land on
// the last-visited view on boot.
router.afterEach((to) => {
  if (to.name && typeof to.name === 'string') {
    store.state.meta.activeView = to.name as any
  }
})

router.isReady().then(() => {
  const persisted = store.state.meta.activeView
  if (persisted && router.currentRoute.value.name !== persisted) {
    const item = NAV_ITEMS.find((n) => n.name === persisted)
    if (item) router.replace(item.path)
  }
  // Cloud sync boot.
  if (cloudIsEnabled()) {
    setCloudStatus('Connecting…', 'syncing')
    // Clear the first-load skeleton as soon as the first pull SETTLES — on
    // success, on failure/offline, or via a safety timeout — so an empty team
    // build that can't reach the server drops to the normal empty state instead
    // of spinning forever.
    const safety = setTimeout(finishHydration, 8000)
    const settle = () => {
      clearTimeout(safety)
      finishHydration()
    }
    cloudPull().then(
      () => {
        settle()
        cloudStartPolling() // fallback / backstop
        cloudStartEventStream() // live push for instant updates
      },
      () => {
        settle()
        cloudStartPolling()
        cloudStartEventStream()
      },
    )
  } else {
    finishHydration()
  }
})

app.mount('#app')
