import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { defineAsyncComponent } from 'vue'
import ViewSkeleton from '@/components/skeleton/ViewSkeleton.vue'
// Overview is the default landing route — import it eagerly so it renders the
// instant the app mounts (no chunk waterfall on first paint). The rest stay
// lazy but load through an async wrapper that shows a view-shaped skeleton if
// the chunk takes longer than `delay` (cached/fast navigations stay instant).
import OverviewView from '@/views/OverviewView.vue'

function lazyView(loader: () => Promise<unknown>) {
  return defineAsyncComponent({
    loader: loader as () => Promise<any>,
    loadingComponent: ViewSkeleton,
    delay: 160,
    timeout: 30000,
  })
}

// Route names mirror the legacy view ids (overview/expenses/budget/tasks/invoices/settings)
// so persisted state.meta.activeView maps 1:1.
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/overview' },
  { path: '/overview', name: 'overview', component: OverviewView },
  { path: '/finance', name: 'expenses', component: lazyView(() => import('@/views/FinanceHubView.vue')) },
  { path: '/budget', name: 'budget', component: lazyView(() => import('@/views/BudgetView.vue')) },
  { path: '/tasks', name: 'tasks', component: lazyView(() => import('@/views/TasksView.vue')) },
  { path: '/invoices', name: 'invoices', component: lazyView(() => import('@/views/InvoicesView.vue')) },
  { path: '/settings', name: 'settings', component: lazyView(() => import('@/views/SettingsView.vue')) },
]

export const NAV_ITEMS: { name: string; path: string; label: string; count?: 'expenses' | 'tasks' | 'invoices' }[] = [
  { name: 'overview', path: '/overview', label: 'Overview' },
  { name: 'expenses', path: '/finance', label: 'Finance hub', count: 'expenses' },
  { name: 'budget', path: '/budget', label: 'Budget' },
  { name: 'tasks', path: '/tasks', label: 'Tasks', count: 'tasks' },
  { name: 'invoices', path: '/invoices', label: 'Invoices', count: 'invoices' },
  { name: 'settings', path: '/settings', label: 'Settings' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
