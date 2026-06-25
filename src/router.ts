import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

// Route names mirror the legacy view ids (overview/expenses/budget/tasks/invoices/settings)
// so persisted state.meta.activeView maps 1:1.
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/overview' },
  { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue') },
  { path: '/finance', name: 'expenses', component: () => import('@/views/FinanceHubView.vue') },
  { path: '/budget', name: 'budget', component: () => import('@/views/BudgetView.vue') },
  { path: '/tasks', name: 'tasks', component: () => import('@/views/TasksView.vue') },
  { path: '/invoices', name: 'invoices', component: () => import('@/views/InvoicesView.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
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
