import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router, NAV_ITEMS } from './router'
import { useDashboard } from './stores/dashboard'
import { cloudIsEnabled, cloudPull, cloudStartPolling, cloudStartEventStream, setCloudStatus } from './lib/cloud'
import './assets/app.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// Instantiate the store now so loadState() + the persistence watch + cloud
// hooks are live before first render.
const store = useDashboard()

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
    cloudPull().then(() => {
      cloudStartPolling() // fallback / backstop
      cloudStartEventStream() // live push for instant updates
    })
  }
})

app.mount('#app')
