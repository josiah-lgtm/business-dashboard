<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { calcMonth } from '@/lib/calc'
import { decisionForCategory } from '@/lib/calc'
import { money, pct } from '@/lib/money'
import { fmtMonth, fmtMonthShort, fmtDate, isoDate, isoMonth, sortedMonthIds, monthOf } from '@/lib/format'
import { renderSpendBars, renderTrendChart, renderDailyChart, renderMultiTrendChart } from '@/lib/charts-render'
import { vChartTip } from '@/lib/chart-tip'

const store = useDashboard()
const { state } = storeToRefs(store)

const monthId = computed(() => state.value.meta.activeMonth)
const ids = computed(() => sortedMonthIds())
const c = computed(() => calcMonth(monthId.value))
const prev = computed(() => {
  const i = ids.value.indexOf(monthId.value)
  return i > 0 ? calcMonth(ids.value[i - 1]) : null
})
const prevShort = computed(() => {
  const i = ids.value.indexOf(monthId.value)
  return i > 0 ? fmtMonthShort(ids.value[i - 1]) : ''
})

function deltaText(now: number, before: number | null | undefined) {
  if (before == null || before === 0) return null
  const d = now - before
  const pctC = (d / Math.abs(before)) * 100
  return { positive: d >= 0, text: `${d >= 0 ? '+' : ''}${pctC.toFixed(1)}% vs ${prevShort.value}` }
}
const revDelta = computed(() => (c.value && prev.value ? deltaText(c.value.adjRev, prev.value.adjRev) : null))

// ---- Charts (v-html) ----
const spendBarsHtml = computed(() => (c.value ? renderSpendBars(c.value) : ''))
const trendHtml = computed(() =>
  renderTrendChart(
    ids.value.map((id) => {
      const cc = calcMonth(id)!
      return { id, val: cc.adjRev, val2: cc.netProfit }
    }),
    'var(--accent)',
    'var(--good)',
    { primary: 'Revenue', secondary: 'Net profit' },
  ),
)

const dailyHtml = computed(() => {
  if (!ids.value.length) return '<div class="help">No data yet.</div>'
  const today = new Date()
  const lastExpenseDate = state.value.expenses
    .map((e) => e.date)
    .filter((d) => d)
    .sort()
    .pop()
  const toIso = lastExpenseDate && lastExpenseDate < isoDate(today) ? lastExpenseDate : isoDate(today)
  const startIso = (() => {
    const d = new Date(toIso)
    d.setDate(d.getDate() - 12 * 7)
    return isoDate(d)
  })()
  const exps = state.value.expenses.filter((e) => e.date && e.date >= startIso && e.date <= toIso)
  const bucketKey = (dateStr: string) => {
    const d = new Date(dateStr)
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    return isoDate(d)
  }
  const groups: Record<string, { total: number; byCat: Record<string, number> }> = {}
  exps.forEach((e) => {
    const k = bucketKey(e.date)
    if (!groups[k]) groups[k] = { total: 0, byCat: {} }
    groups[k].total += e.amount
    groups[k].byCat[e.category] = (groups[k].byCat[e.category] || 0) + e.amount
  })
  const keys = Object.keys(groups).sort()
  return keys.length ? renderDailyChart(keys, groups, 'week', (k) => fmtDate(k)) : '<div class="help">No spend in the last 12 weeks.</div>'
})

// ---- Team roster summary ----
const team = computed(() => {
  const roster = (state.value.team || []).slice()
  if (!roster.length) return { hasRoster: false } as const
  const payouts = (state.value.teamPayouts || []).filter((p) => p.month === monthId.value)
  const paidByMember: Record<string, number> = {}
  payouts.forEach((p) => {
    paidByMember[p.memberId] = (paidByMember[p.memberId] || 0) + (Number(p.amount) || 0)
  })
  const groupsMap = new Map<string, typeof roster>()
  roster.forEach((t) => {
    const key = (t.role || '').trim() || 'No role'
    if (!groupsMap.has(key)) groupsMap.set(key, [])
    groupsMap.get(key)!.push(t)
  })
  const activeRoster = roster.filter((t) => t.active !== false)
  const groups = [...groupsMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, members]) => ({
      role,
      activeCount: members.filter((t) => t.active !== false).length,
      count: members.length,
      roleTarget: members.filter((t) => t.active !== false).reduce((s, t) => s + (Number(t.amount) || 0), 0),
      rolePaid: members.reduce((s, t) => s + (paidByMember[t.id] || 0), 0),
      members: members.map((t) => ({
        id: t.id,
        name: t.name,
        payType: t.payType,
        target: Number(t.amount) || 0,
        paid: paidByMember[t.id] || 0,
        isActive: t.active !== false,
      })),
    }))
  return {
    hasRoster: true,
    activeCount: activeRoster.length,
    rosterCount: roster.length,
    salaryRoll: activeRoster.filter((t) => t.payType === 'salary').reduce((s, t) => s + (Number(t.amount) || 0), 0),
    commRoll: activeRoster.filter((t) => t.payType === 'commission').reduce((s, t) => s + (Number(t.amount) || 0), 0),
    paidTotal: payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0),
    payoutsCount: payouts.length,
    groups,
  } as const
})

// ---- Channel decisions ----
const decisions = computed(() =>
  ['LinkedIn Channel', 'Email Channel', 'SMS', 'One off'].map((cat) => {
    const d = decisionForCategory(cat)
    return {
      cat,
      ...d,
      trendArrow: d.trendPct >= 5 ? '↑' : d.trendPct <= -5 ? '↓' : '→',
      trendColor: d.action === 'double-down' ? 'var(--good)' : d.action === 'fix' ? 'var(--bad)' : 'var(--text-tertiary)',
    }
  }),
)

// ---- All months table ----
const allMonths = computed(() =>
  ids.value.map((id) => {
    const cc = calcMonth(id)!
    return {
      id,
      isActive: id === monthId.value,
      revenue: cc.raw.revenue,
      refunds: cc.refundsTotal,
      adjRev: cc.adjRev,
      salaries: cc.raw.salariesTotal,
      commissions: cc.raw.commissionsTotal,
      totalExp: cc.totalExpenses,
      netProfit: cc.netProfit,
      netMarginPct: cc.netMarginPct,
    }
  }),
)

// ---- Projections ----
const projWindow = ref(3)
const projRev = ref(0)
const projExp = ref(0)
const projection = computed(() => {
  const w = projWindow.value || 3
  const revGrowth = (projRev.value || 0) / 100
  const expGrowth = (projExp.value || 0) / 100
  const baseIds = ids.value.slice(-w)
  if (!baseIds.length) return null
  const calcs = baseIds.map((id) => calcMonth(id)!)
  const avgRev = calcs.reduce((s, cc) => s + cc.adjRev, 0) / calcs.length
  const avgExp = calcs.reduce((s, cc) => s + cc.totalExpenses, 0) / calcs.length
  const lastId = ids.value[ids.value.length - 1]
  const [ly, lm] = lastId.split('-').map(Number)
  const projections = []
  for (let i = 1; i <= 6; i++) {
    const d = new Date(ly, lm - 1 + i, 1)
    const id = isoMonth(d)
    const rev = avgRev * Math.pow(1 + revGrowth, i)
    const exp = avgExp * Math.pow(1 + expGrowth, i)
    projections.push({ id, rev, exp, net: rev - exp })
  }
  const historical = ids.value.map((id) => {
    const cc = calcMonth(id)!
    return { id, rev: cc.adjRev, exp: cc.totalExpenses, net: cc.netProfit }
  })
  const combined = [...historical, ...projections]
  return {
    totalRev: projections.reduce((s, p) => s + p.rev, 0),
    totalExp: projections.reduce((s, p) => s + p.exp, 0),
    totalNet: projections.reduce((s, p) => s + p.net, 0),
    html: renderMultiTrendChart(combined, historical.length),
  }
})

function pickMonth(id: string) {
  store.setActiveMonth(id)
}
function delMonth(id: string) {
  if (!confirm(`Delete ${fmtMonth(id)} and all its expenses?`)) return
  store.deleteMonth(id)
}
void monthOf
</script>

<template>
  <section class="panel active" data-view="overview">
    <div class="panel-header">
      <div>
        <h2>Overview</h2>
        <div class="sub">Snapshot for <span>{{ fmtMonth(monthId) }}</span></div>
      </div>
    </div>

    <div v-if="!c" class="empty">
      <h3>No data for this month</h3>
      <p>Pick another month or add some expenses.</p>
    </div>

    <template v-else>
      <!-- KPIs -->
      <div class="grid grid-3">
        <div class="kpi">
          <div class="lbl">Revenue</div>
          <div class="val">{{ money(c.adjRev) }}</div>
          <div v-if="revDelta" class="sub" :style="{ color: revDelta.positive ? 'var(--good)' : 'var(--bad)' }">{{ revDelta.text }}</div>
        </div>
        <div class="kpi">
          <div class="lbl">Net Profit</div>
          <div class="val" :class="c.netProfit >= 0 ? 'good' : 'bad'">{{ money(c.netProfit) }}</div>
          <div class="sub">{{ pct(c.netMarginPct) }} margin</div>
        </div>
        <div class="kpi">
          <div class="lbl">Cash to set aside</div>
          <div class="val warn">{{ money(c.totalToSetAside) }}</div>
          <div class="sub">{{ money(c.taxReserve) }} corp tax + {{ money(c.founderTaxReserve) }} founder tax</div>
        </div>
      </div>

      <!-- Founder comp -->
      <div v-if="c.founderComp > 0 || c.founderTaxReserve > 0" class="card">
        <h3>Founder compensation — {{ fmtMonth(monthId) }}</h3>
        <div class="grid grid-3">
          <div class="kpi"><div class="lbl">Draw / salary</div><div class="val">{{ money(c.founderComp) }}</div></div>
          <div class="kpi"><div class="lbl">Tax due ({{ state.targets.founderTaxPct }}%)</div><div class="val warn">{{ money(c.founderTaxReserve) }}</div></div>
          <div class="kpi"><div class="lbl">Net to you after tax</div><div class="val good">{{ money(c.founderComp - c.founderTaxReserve) }}</div></div>
        </div>
      </div>

      <!-- Spend bars -->
      <div class="card">
        <h3>Where the money went — {{ fmtMonth(monthId) }}</h3>
        <div v-chart-tip class="chart-host" v-html="spendBarsHtml"></div>
      </div>

      <!-- Trend -->
      <div class="card">
        <h3>Trend</h3>
        <div v-chart-tip class="chart-host" v-html="trendHtml"></div>
        <div class="chart-legend" style="margin-top: 8px; justify-content: center">
          <span><span class="dot" style="background: var(--accent)"></span>Revenue</span>
          <span><span class="dot" style="background: var(--good)"></span>Net profit</span>
        </div>
      </div>

      <!-- Daily -->
      <div class="card">
        <h3>Last 12 weeks of spend</h3>
        <div v-chart-tip class="chart-host" v-html="dailyHtml"></div>
      </div>

      <!-- Team -->
      <div class="card">
        <h3>Team roster &amp; pay — {{ fmtMonth(monthId) }}</h3>
        <div v-if="!team.hasRoster" class="help">No team members yet. Add people in the Finance hub → Team roster.</div>
        <template v-else>
          <div class="grid grid-4" style="margin-bottom: 14px">
            <div class="kpi"><div class="lbl">Active team</div><div class="val">{{ team.activeCount }}</div><div class="sub">of {{ team.rosterCount }} on roster</div></div>
            <div class="kpi"><div class="lbl">Salary roll</div><div class="val">{{ money(team.salaryRoll) }}</div><div class="sub">monthly target</div></div>
            <div class="kpi"><div class="lbl">Commission roll</div><div class="val">{{ money(team.commRoll) }}</div><div class="sub">monthly target</div></div>
            <div class="kpi"><div class="lbl">Paid this month</div><div class="val" :class="{ good: team.paidTotal > 0 }">{{ money(team.paidTotal) }}</div><div class="sub">{{ team.payoutsCount }} payout{{ team.payoutsCount === 1 ? '' : 's' }}</div></div>
          </div>
          <div v-for="g in team.groups" :key="g.role" style="margin-top: 14px">
            <div
              style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; padding: 6px 0; border-bottom: 1px solid var(--border)"
            >
              <span>{{ g.role }} · {{ g.activeCount }}/{{ g.count }} active</span>
              <span style="color: var(--text); font-variant-numeric: tabular-nums">{{ money(g.roleTarget) }}/mo · paid {{ money(g.rolePaid) }}</span>
            </div>
            <div
              v-for="m in g.members"
              :key="m.id"
              style="display: grid; grid-template-columns: 1fr 110px 110px 110px; gap: 12px; align-items: center; padding: 8px 2px; font-size: 13px"
              :style="{ opacity: m.isActive ? 1 : 0.45 }"
            >
              <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                <span style="font-weight: 500">{{ m.name }}</span>
                <span style="color: var(--text-tertiary); font-size: 11px; margin-left: 4px">{{ m.payType === 'commission' ? 'commission' : 'salary' }}{{ m.isActive ? '' : ' · inactive' }}</span>
              </div>
              <div style="text-align: right; font-variant-numeric: tabular-nums; color: var(--text-secondary)">{{ money(m.target) }}<span style="color: var(--text-tertiary); font-size: 11px; margin-left: 4px">/mo</span></div>
              <div style="text-align: right; font-variant-numeric: tabular-nums" :style="{ color: m.paid > 0 ? 'var(--good)' : 'var(--text-tertiary)' }">{{ money(m.paid) }}<span style="color: var(--text-tertiary); font-size: 11px; margin-left: 4px">paid</span></div>
              <div style="text-align: right; font-variant-numeric: tabular-nums; font-size: 11px; color: var(--text-tertiary)">
                <span v-if="m.target <= 0">—</span>
                <span v-else-if="m.paid >= m.target" style="color: var(--good)">✓ on target</span>
                <span v-else>{{ money(m.target - m.paid) }} to go</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- All months -->
      <div class="card">
        <h3>All months — at a glance</h3>
        <table v-if="allMonths.length">
          <thead>
            <tr>
              <th>Month</th>
              <th class="num">Revenue</th>
              <th class="num">Refunds</th>
              <th class="num">Adj Rev</th>
              <th class="num">Salaries</th>
              <th class="num">Commissions</th>
              <th class="num">Total Exp</th>
              <th class="num">Net Profit</th>
              <th class="num">Margin</th>
              <th class="actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in allMonths" :key="r.id" :style="r.isActive ? 'background:rgba(212,160,23,0.06)' : ''">
              <td>
                <a href="#" @click.prevent="pickMonth(r.id)" style="color: var(--accent); text-decoration: none" :style="{ fontWeight: r.isActive ? 600 : 500 }">{{ fmtMonth(r.id) }}</a>
              </td>
              <td class="num">{{ money(r.revenue) }}</td>
              <td class="num">{{ money(r.refunds) }}</td>
              <td class="num">{{ money(r.adjRev) }}</td>
              <td class="num">{{ money(r.salaries) }}</td>
              <td class="num">{{ money(r.commissions) }}</td>
              <td class="num">{{ money(r.totalExp) }}</td>
              <td class="num" :style="{ color: r.netProfit >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 600 }">{{ money(r.netProfit) }}</td>
              <td class="num">{{ pct(r.netMarginPct) }}</td>
              <td class="actions"><button class="small ghost" title="Delete month" @click="delMonth(r.id)">×</button></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="help">No months yet.</div>
      </div>

      <!-- Projections -->
      <div class="card">
        <h3>Next 6 months — projection</h3>
        <div style="display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; align-items: flex-end">
          <div style="flex: 0 0 auto">
            <label style="font-size: 11px">Based on last</label>
            <select v-model.number="projWindow" style="width: 80px"><option :value="2">2 mo</option><option :value="3">3 mo</option><option :value="6">6 mo</option></select>
          </div>
          <div style="flex: 0 0 auto"><label style="font-size: 11px">Rev growth /mo</label><input v-model.number="projRev" type="number" step="0.5" style="width: 80px" /> %</div>
          <div style="flex: 0 0 auto"><label style="font-size: 11px">Exp growth /mo</label><input v-model.number="projExp" type="number" step="0.5" style="width: 80px" /> %</div>
        </div>
        <div v-if="!projection" class="help">No history yet.</div>
        <template v-else>
          <div class="grid grid-3" style="margin-bottom: 12px">
            <div class="kpi"><div class="lbl">6-mo revenue</div><div class="val">{{ money(projection.totalRev) }}</div></div>
            <div class="kpi"><div class="lbl">6-mo expenses</div><div class="val">{{ money(projection.totalExp) }}</div></div>
            <div class="kpi"><div class="lbl">6-mo net profit</div><div class="val" :class="projection.totalNet >= 0 ? 'good' : 'bad'">{{ money(projection.totalNet) }}</div></div>
          </div>
          <div class="chart-legend">
            <span><span class="dot" style="background: var(--accent)"></span>Revenue</span>
            <span><span class="dot" style="background: var(--bad)"></span>Expenses</span>
            <span><span class="dot" style="background: var(--good)"></span>Net profit</span>
            <span style="margin-left: auto; font-style: italic; color: var(--text-tertiary)">Solid = actual · Dashed = projected</span>
          </div>
          <div v-chart-tip class="chart-host" v-html="projection.html"></div>
        </template>
      </div>

      <!-- Decisions -->
      <div class="card">
        <h3>Channel spend (last 3 months)</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px">
          <div v-for="d in decisions" :key="d.cat" class="decision-card" :class="d.action" style="margin: 0">
            <div class="head">
              <span class="name"><span class="pill" :class="`cat-${d.cat.toLowerCase().replace(/[^a-z]+/g, '-')}`">{{ d.cat }}</span></span>
              <span class="pill" :class="d.action">{{ d.label }}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-tertiary); margin-top: 6px">
              <span>3-mo avg</span><span style="color: var(--text); font-variant-numeric: tabular-nums">{{ money(d.monthlySpend) }}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); margin-top: 4px">
              <span>Trend</span><span :style="{ color: d.trendColor }" style="font-variant-numeric: tabular-nums">{{ d.trendArrow }} {{ Math.abs(d.trendPct).toFixed(0) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
