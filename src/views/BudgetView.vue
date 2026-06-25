<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { categoryTotals, refundsForMonth, prevMonthId } from '@/lib/calc'
import { money, pct } from '@/lib/money'
import { fmtMonth } from '@/lib/format'
import { renderBudgetPie } from '@/components/finance/budget-pie'
import type { Budget } from '@/types'

const store = useDashboard()
const { state } = storeToRefs(store)

// ---- Budget row definitions (mirror the Finance hub bucket layout 1:1). ----
interface BudgetItem {
  key: string
  label: string
  source: 'category' | 'month'
  kind?: 'goal'
  icon?: string
  color?: string
  fallbackMonthField?: string
}
interface BudgetSection {
  section: string
  items: BudgetItem[]
}
const BUDGET_ROWS: BudgetSection[] = [
  {
    section: 'Revenue goal',
    items: [{ key: 'revenue', label: 'Revenue', source: 'month', kind: 'goal', icon: '💰', color: '#d4a017' }],
  },
  {
    section: 'Acquisition',
    items: [
      { key: 'Base Software', label: 'Base Software', source: 'category', icon: '⚙️', color: '#5e9eff' },
      { key: 'LinkedIn Channel', label: 'LinkedIn Channel', source: 'category', icon: '💼', color: '#bf5af2' },
      { key: 'Email Channel', label: 'Email Channel', source: 'category', icon: '✉️', color: '#64d2ff' },
      { key: 'SMS', label: 'SMS Channel', source: 'category', icon: '📲', color: '#ff9f0a' },
      { key: 'One off', label: 'One off', source: 'category', icon: '✨', color: '#ff9500' },
    ],
  },
  {
    section: 'People',
    items: [
      { key: 'salariesTotal', label: 'Team salaries', source: 'month', icon: '🏷', color: '#30d158' },
      { key: 'commissionsTotal', label: 'Commissions', source: 'month', icon: '💰', color: '#34c759' },
      { key: 'Founder comp', label: 'Founder compensation', source: 'category', icon: '👑', color: '#d4a017', fallbackMonthField: 'founderComp' },
    ],
  },
  {
    section: 'Other',
    items: [
      { key: 'Referral payouts', label: 'Referral payouts', source: 'category', icon: '🤝', color: '#ff8a3d', fallbackMonthField: 'referralPayoutsTotal' },
      { key: 'Merchant fees', label: 'Merchant / Stripe fees', source: 'category', icon: '💳', color: '#7c8aa3', fallbackMonthField: 'merchantFees' },
      { key: 'refundsTotal', label: 'Refunds (cap)', source: 'month', icon: '↩️', color: '#ff453a' },
    ],
  },
]

const monthId = computed(() => state.value.meta.activeMonth)
const prev = computed(() => prevMonthId(monthId.value))

// Ensure a budget object exists for the active month (matches legacy renderBudget).
const budget = computed<Budget>(() => {
  if (!state.value.budgets[monthId.value]) state.value.budgets[monthId.value] = {}
  return state.value.budgets[monthId.value]
})

function budgetVal(key: string): number {
  const v = budget.value[key]
  return typeof v === 'number' ? v : 0
}

function actualForBudgetRow(item: BudgetItem, mId: string): number {
  if (item.source === 'category') {
    const fromItems = categoryTotals(mId)[item.key] || 0
    // Fall back to legacy month-field aggregate when no line items exist yet.
    if (fromItems > 0) return fromItems
    if (item.fallbackMonthField) return ((state.value.months[mId] as any) || {})[item.fallbackMonthField] || 0
    return 0
  }
  // month field — special handling for refundsTotal which may sum from refunds[]
  if (item.key === 'refundsTotal') {
    const sumFromRecords = refundsForMonth(mId).reduce((s, r) => s + r.amount, 0)
    return sumFromRecords || ((state.value.months[mId] as any) || {})[item.key] || 0
  }
  return ((state.value.months[mId] as any) || {})[item.key] || 0
}

// ---- Totals ----
const totals = computed(() => {
  let totalBudget = 0,
    totalActual = 0,
    totalGoalBudget = 0,
    totalGoalActual = 0
  BUDGET_ROWS.forEach((s) =>
    s.items.forEach((item) => {
      const b = budgetVal(item.key)
      const a = actualForBudgetRow(item, monthId.value)
      if (item.kind === 'goal') {
        totalGoalBudget += b
        totalGoalActual += a
      } else {
        totalBudget += b
        totalActual += a
      }
    }),
  )
  const remaining = totalBudget - totalActual
  const usedPct = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0
  const goalPct = totalGoalBudget > 0 ? (totalGoalActual / totalGoalBudget) * 100 : 0
  // Planned profit if you hit revenue goal AND stay within all expense caps.
  const estimatedProfit = totalGoalBudget - totalBudget
  const estimatedMarginPct = totalGoalBudget > 0 ? (estimatedProfit / totalGoalBudget) * 100 : 0
  return { totalBudget, totalActual, totalGoalBudget, totalGoalActual, remaining, usedPct, goalPct, estimatedProfit, estimatedMarginPct }
})

// Empty-state hint (no expense budgets set yet).
const isEmpty = computed(() =>
  Object.entries(budget.value).every(([k, v]) => k.startsWith('_') || !v || v === 0),
)
const showSuggestionHint = computed(() => isEmpty.value && !!prev.value)

// ---- Pie chart (v-html) ----
const pieItems = computed(() => {
  const out: { label: string; value: number; color?: string; icon?: string }[] = []
  BUDGET_ROWS.forEach((section) => {
    if (section.section === 'Revenue goal') return
    section.items.forEach((item) => {
      const v = budgetVal(item.key)
      if (v > 0) out.push({ label: item.label, value: v, color: item.color, icon: item.icon })
    })
  })
  return out
})
const pieSvg = computed(() => renderBudgetPie(pieItems.value, totals.value.totalBudget))
const pieLegend = computed(() =>
  pieItems.value.map((p) => ({
    ...p,
    share: totals.value.totalBudget > 0 ? (p.value / totals.value.totalBudget) * 100 : 0,
  })),
)

// ---- Sections / bucket cards ----
interface BucketView {
  item: BudgetItem
  budgetValue: number
  actual: number
  suggested: number
  status: 'ok' | 'near' | 'over'
  statusLabel: string
  fillPct: number
  sliderMax: number
  step: number
  sliderPctVar: string
}

function buildBucket(item: BudgetItem): BucketView {
  const budgetValue = budgetVal(item.key)
  const actual = actualForBudgetRow(item, monthId.value)
  const suggested = prev.value ? actualForBudgetRow(item, prev.value) : 0
  let progressPct: number
  let status: 'ok' | 'near' | 'over'
  let statusLabel: string
  if (item.kind === 'goal') {
    progressPct = budgetValue > 0 ? (actual / budgetValue) * 100 : 0
    if (progressPct >= 100) {
      status = 'ok'
      statusLabel = `${progressPct.toFixed(0)}% met`
    } else if (progressPct >= 75) {
      status = 'near'
      statusLabel = `${progressPct.toFixed(0)}% of goal`
    } else {
      status = 'over'
      statusLabel = `${progressPct.toFixed(0)}% of goal`
    }
  } else {
    progressPct = budgetValue > 0 ? (actual / budgetValue) * 100 : actual > 0 ? 999 : 0
    if (progressPct > 100) {
      status = 'over'
      statusLabel = `over by ${money(actual - budgetValue)}`
    } else if (progressPct > 90) {
      status = 'near'
      statusLabel = `${progressPct.toFixed(0)}% used`
    } else {
      status = 'ok'
      statusLabel = `${progressPct.toFixed(0)}% used`
    }
  }
  const fillPct = Math.min(100, progressPct)
  // Slider range: scales to the largest of (prev actual ×2, budget ×1.5, actual ×1.5, baseline).
  const baseline = item.kind === 'goal' ? 10000 : 1000
  const sliderMax = Math.max(baseline, Math.ceil(Math.max(suggested * 2, budgetValue * 1.5, actual * 1.5) / 100) * 100)
  const step = sliderMax >= 10000 ? 100 : sliderMax >= 1000 ? 10 : 1
  const sliderPctVar = sliderMax > 0 ? ((budgetValue / sliderMax) * 100).toFixed(1) + '%' : '0%'
  return { item, budgetValue, actual, suggested, status, statusLabel, fillPct, sliderMax, step, sliderPctVar }
}

const sections = computed(() =>
  BUDGET_ROWS.map((section) => {
    const buckets = section.items.map(buildBucket)
    return {
      section: section.section,
      buckets,
      budgetTotal: buckets.reduce((s, b) => s + b.budgetValue, 0),
      actualTotal: buckets.reduce((s, b) => s + b.actual, 0),
    }
  }),
)

// ---- Save status line ----
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`
  const days = Math.round(diffSec / 86400)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const saveStatus = computed(() => {
  const b = budget.value
  const hasValues = Object.entries(b).some(([k, v]) => !k.startsWith('_') && typeof v === 'number' && v > 0)
  if (!hasValues) {
    return { cls: 'unset', text: `Not set for ${fmtMonth(monthId.value)}` }
  }
  const savedAt = b._savedAt
  if (savedAt) {
    return { cls: 'saved', text: `Budget set · saved ${relativeTime(savedAt)}` }
  }
  return { cls: 'saved', text: 'Budget set' }
})

// ---- Mutations ----
function setValue(key: string, raw: string | number) {
  const num = parseFloat(String(raw)) || 0
  budget.value[key] = num
  markBudgetSaved()
}

function markBudgetSaved() {
  if (!state.value.budgets[monthId.value]) state.value.budgets[monthId.value] = {}
  state.value.budgets[monthId.value]._savedAt = new Date().toISOString()
}

function onSliderInput(key: string, raw: string) {
  setValue(key, raw)
}
function onInput(key: string, raw: string) {
  setValue(key, raw)
}
function applySuggested(b: BucketView) {
  setValue(b.item.key, b.suggested)
}

function suggestFromPrev() {
  const p = prev.value
  if (!p) {
    alert('No previous month to suggest from.')
    return
  }
  const out: Budget = {}
  BUDGET_ROWS.forEach((s) =>
    s.items.forEach((item) => {
      out[item.key] = Math.round(actualForBudgetRow(item, p) * 100) / 100
    }),
  )
  out._savedAt = new Date().toISOString()
  state.value.budgets[monthId.value] = out
}

function resetToZero() {
  if (!confirm(`Clear all budget targets for ${fmtMonth(monthId.value)}?`)) return
  state.value.budgets[monthId.value] = {}
}
</script>

<template>
  <section class="panel active" data-view="budget">
    <div class="panel-header">
      <div>
        <h2>Budget</h2>
        <div class="sub">Plan the month. Slide each lever to set a target. Bars fill in red when actual spend approaches your cap.</div>
        <div class="budget-save-status" :class="saveStatus.cls" style="margin-top: 10px">{{ saveStatus.text }}</div>
      </div>
      <div class="actions">
        <button class="primary" @click="suggestFromPrev">↻ Suggest from previous month</button>
        <button class="ghost" @click="resetToZero">Reset to zero</button>
      </div>
    </div>

    <div>
      <!-- Empty-state hint -->
      <div v-if="showSuggestionHint" class="budget-empty-state" style="margin-bottom: 22px">
        <h3>No budget set for {{ fmtMonth(monthId) }} yet</h3>
        <p>
          Click <b>Suggest from previous month</b> in the top-right to pre-fill based on {{ fmtMonth(prev!) }}'s actuals — then adjust each
          bucket.
        </p>
      </div>

      <!-- Summary KPIs -->
      <div class="budget-summary">
        <div class="kpi">
          <div class="lbl">Revenue goal</div>
          <div class="val">{{ money(totals.totalGoalBudget) }}</div>
          <div class="sub">{{ money(totals.totalGoalActual) }} actual · {{ totals.goalPct.toFixed(0) }}%</div>
        </div>
        <div class="kpi">
          <div class="lbl">Expense budget</div>
          <div class="val">{{ money(totals.totalBudget) }}</div>
          <div class="sub">target spending cap</div>
        </div>
        <div class="kpi">
          <div class="lbl">Estimated profit</div>
          <div class="val" :class="totals.estimatedProfit >= 0 ? 'good' : 'bad'">{{ money(totals.estimatedProfit) }}</div>
          <div class="sub">{{ pct(totals.estimatedMarginPct) }} margin if on-plan</div>
        </div>
        <div class="kpi">
          <div class="lbl">Spent so far</div>
          <div class="val" :class="totals.usedPct > 100 ? 'bad' : totals.usedPct > 90 ? 'warn' : ''">{{ money(totals.totalActual) }}</div>
          <div class="sub">{{ totals.usedPct.toFixed(0) }}% of budget</div>
        </div>
        <div class="kpi">
          <div class="lbl">{{ totals.remaining >= 0 ? 'Remaining' : 'Over budget' }}</div>
          <div class="val" :class="totals.remaining < 0 ? 'bad' : totals.remaining < totals.totalBudget * 0.1 ? 'warn' : 'good'">
            {{ money(Math.abs(totals.remaining)) }}
          </div>
          <div class="sub">{{ totals.remaining >= 0 ? 'room left' : 'over the cap' }}</div>
        </div>
      </div>

      <!-- Pie / allocation -->
      <div class="bg-pie-card">
        <div class="bg-pie-svg" v-html="pieSvg"></div>
        <div class="bg-pie-legend">
          <div class="bg-pie-title">Budget allocation — {{ fmtMonth(monthId) }}</div>
          <div v-if="!pieItems.length" class="help" style="margin-top: 8px">
            No budget set for any bucket yet. Enter amounts in the cards below — the pie fills in as you type.
          </div>
          <div v-else class="bg-pie-items">
            <div v-for="p in pieLegend" :key="p.label" class="bg-pie-item">
              <span class="dot" :style="{ background: p.color }"></span>
              <span class="lbl">{{ p.icon || '•' }} {{ p.label }}</span>
              <span class="val">{{ money(p.value) }}</span>
              <span class="pct">{{ p.share.toFixed(0) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Sections -->
      <div v-for="sec in sections" :key="sec.section" class="bg-section">
        <div class="bg-section-head">
          <span class="title">{{ sec.section }}</span>
          <span class="total"
            ><span class="actual">{{ money(sec.actualTotal) }}</span> actual / <span class="budget">{{ money(sec.budgetTotal) }}</span> budgeted</span
          >
        </div>
        <div class="bg-bucket-grid">
          <div
            v-for="b in sec.buckets"
            :key="b.item.key"
            class="bg-bucket"
            :class="{ 'is-goal': b.item.kind === 'goal' }"
            :data-key="b.item.key"
            :style="{ '--bucket-color': b.item.color || '#5e9eff' }"
          >
            <div class="bg-bucket-head">
              <span class="icon">{{ b.item.icon || '•' }}</span>
              <span class="name">{{ b.item.label }}</span>
            </div>
            <div class="bg-bucket-amount">
              <span class="cur">£</span>
              <input
                type="number"
                class="bg-bucket-input"
                min="0"
                step="0.01"
                :value="b.budgetValue"
                @input="onInput(b.item.key, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="bg-bucket-dial">
              <input
                type="range"
                class="bg-bucket-slider"
                min="0"
                :max="b.sliderMax"
                :step="b.step"
                :value="Math.min(b.budgetValue, b.sliderMax)"
                :style="{ '--pct': b.sliderPctVar }"
                @input="onSliderInput(b.item.key, ($event.target as HTMLInputElement).value)"
              />
              <div class="bg-bucket-dial-meta"><span>£0</span><span>{{ money(b.sliderMax) }}</span></div>
            </div>
            <div class="bg-bucket-bar">
              <div class="fill" :class="b.status" :style="{ width: b.fillPct.toFixed(1) + '%' }"></div>
            </div>
            <div class="bg-bucket-meta">
              <span class="actual">{{ money(b.actual) }} actual</span>
              <span class="status val" :class="b.status">{{ b.statusLabel }}</span>
            </div>
            <div v-if="b.suggested > 0" style="margin-top: 6px">
              <button
                type="button"
                class="bg-bucket-suggest"
                :title="`Use previous-month actual ${money(b.suggested)}`"
                @click="applySuggested(b)"
              >
                ↻ {{ money(b.suggested) }} (prev)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
