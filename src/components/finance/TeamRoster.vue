<script setup lang="ts">
// Team roster + per-person pay — ports legacy renderTeam.
// Group-by-role buckets, inline name/amount edit, salary/commission toggle,
// founder singleton, active toggle, delete, drag-drop role reassignment,
// rename role, add role/member, and "push active salaries to month".
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useDashboard } from '@/stores/dashboard'
import { money } from '@/lib/money'
import { uid, isoDate, fmtMonth } from '@/lib/format'
import type { TeamMember } from '@/types'

const store = useDashboard()
const { state } = storeToRefs(store)

const monthLabel = computed(() => fmtMonth(state.value.meta.activeMonth))

interface RoleGroup {
  role: string
  members: TeamMember[]
  roleTotal: number
  activeCount: number
}

const groups = computed<RoleGroup[]>(() => {
  const map = new Map<string, TeamMember[]>()
  state.value.team.forEach((t) => {
    const key = (t.role || '').trim() || 'No role'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  })
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, members]) => ({
      role,
      members,
      activeCount: members.filter((t) => t.active !== false).length,
      roleTotal: members.filter((t) => t.active !== false).reduce((s, t) => s + (Number(t.amount) || 0), 0),
    }))
})

const totalActive = computed(() => state.value.team.filter((t) => t.active !== false).length)
const totalSalary = computed(() =>
  state.value.team.filter((t) => t.active !== false && t.payType === 'salary').reduce((s, t) => s + (Number(t.amount) || 0), 0),
)
const totalComm = computed(() =>
  state.value.team.filter((t) => t.active !== false && t.payType === 'commission').reduce((s, t) => s + (Number(t.amount) || 0), 0),
)

function newMember(role: string): TeamMember {
  return {
    id: uid(), name: 'New member', role,
    amount: 0, payType: 'salary', active: true,
    monthlySalary: 0, commissionAmount: 0,
    email: '', address: '', country: 'GB', bank: {}, password: '',
  } as TeamMember
}

function addRole() {
  const name = prompt('Role name (e.g. SETTER, CLOSER, OPS):')
  if (!name || !name.trim()) return
  state.value.team.push(newMember(name.trim().toUpperCase()))
}

function addMember(role: string) {
  state.value.team.push(newMember(role === 'No role' ? '' : role))
}

// "+ Add person" (legacy team-add-btn) — prompts for a name, no role.
function addPerson() {
  const name = prompt('Team member name:')
  if (!name) return
  const m = newMember('')
  m.name = name.trim()
  state.value.team.push(m)
}

defineExpose({ addPerson })

function pushActiveSalaries() {
  const monthId = state.value.meta.activeMonth
  const active = state.value.team.filter((t) => t.active !== false && t.payType === 'salary' && (Number(t.amount) || 0) > 0)
  if (!active.length) {
    alert('No active salaried team members.')
    return
  }
  let added = 0
  active.forEach((t) => {
    const exists = (state.value.teamPayouts || []).some((p) => p.memberId === t.id && p.month === monthId && p.type === 'salary')
    if (exists) return
    state.value.teamPayouts.push({
      id: uid(), memberId: t.id, month: monthId, date: isoDate(new Date()),
      amount: Number(t.amount) || 0, type: 'salary', notes: 'auto-pushed from roster',
    })
    added++
  })
  // Recalc month totals from payouts.
  const payouts = (state.value.teamPayouts || []).filter((p) => p.month === monthId)
  if (payouts.length && state.value.months[monthId]) {
    state.value.months[monthId].salariesTotal = payouts.filter((p) => p.type === 'salary').reduce((s, p) => s + (Number(p.amount) || 0), 0)
    state.value.months[monthId].commissionsTotal = payouts.filter((p) => p.type === 'commission').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  }
  alert(`Pushed ${added} salary payout${added === 1 ? '' : 's'} to ${monthLabel.value}.`)
}

function renameRole(group: RoleGroup, value: string) {
  const newRole = value.trim()
  if (!newRole || newRole === group.role) return
  state.value.team
    .filter((t) => ((t.role || '').trim() || 'No role') === group.role)
    .forEach((t) => {
      t.role = newRole === 'No role' ? '' : newRole
    })
}

function setName(t: TeamMember, value: string) {
  t.name = value
}
function setAmount(t: TeamMember, value: string) {
  t.amount = parseFloat(value) || 0
}
function setPayType(t: TeamMember, type: 'salary' | 'commission') {
  t.payType = type
  if (type === 'salary') {
    t.monthlySalary = t.amount || 0
    t.commissionAmount = 0
  } else {
    t.commissionAmount = t.amount || 0
    t.monthlySalary = 0
  }
}
function toggleActive(t: TeamMember) {
  t.active = !(t.active !== false)
}
function toggleFounder(t: TeamMember) {
  const newVal = !t.isFounder
  if (newVal) state.value.team.forEach((x) => (x.isFounder = false))
  t.isFounder = newVal
}
function delMember(t: TeamMember) {
  state.value.team = state.value.team.filter((x) => x.id !== t.id)
}

// ---- Drag-drop role reassignment ----
const dragTargetRole = ref<string | null>(null)

function onDragStart(ev: DragEvent, t: TeamMember) {
  if (!ev.dataTransfer) return
  ev.dataTransfer.effectAllowed = 'move'
  ev.dataTransfer.setData('application/x-team-member-id', t.id)
  const row = (ev.target as HTMLElement).closest('.tr-member-row') as HTMLElement | null
  if (row) {
    try {
      ev.dataTransfer.setDragImage(row, 12, 18)
    } catch {
      /* ignore */
    }
    row.classList.add('is-dragging')
  }
}
function onDragEnd(ev: DragEvent) {
  const row = (ev.target as HTMLElement).closest('.tr-member-row') as HTMLElement | null
  if (row) row.classList.remove('is-dragging')
  dragTargetRole.value = null
}
function onDragOver(ev: DragEvent, role: string) {
  const types = ev.dataTransfer && ev.dataTransfer.types
  if (!types || !Array.from(types).includes('application/x-team-member-id')) return
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
  dragTargetRole.value = role
}
function onDragLeave(role: string) {
  if (dragTargetRole.value === role) dragTargetRole.value = null
}
function onDrop(ev: DragEvent, role: string) {
  ev.preventDefault()
  dragTargetRole.value = null
  const memberId = ev.dataTransfer?.getData('application/x-team-member-id')
  if (!memberId) return
  const member = state.value.team.find((x) => x.id === memberId)
  if (!member) return
  const newRole = role === 'No role' ? '' : role
  const oldRole = (member.role || '').trim()
  if (oldRole === newRole) return
  member.role = newRole
}
</script>

<template>
  <div v-if="!state.team.length" class="empty"><h3>No team members</h3></div>
  <div v-else>
    <div class="grid grid-3" style="margin-bottom: 14px">
      <div class="kpi"><div class="lbl">Salary roll</div><div class="val">{{ money(totalSalary) }}</div><div class="sub">monthly</div></div>
      <div class="kpi"><div class="lbl">Commission roll</div><div class="val">{{ money(totalComm) }}</div><div class="sub">monthly</div></div>
      <div class="kpi"><div class="lbl">Active team</div><div class="val">{{ totalActive }}</div><div class="sub">of {{ state.team.length }}</div></div>
    </div>
    <div class="tr-roster-actions">
      <button class="small" @click="addRole">+ Add role</button>
      <button class="primary small" @click="pushActiveSalaries">Push active salaries to {{ monthLabel }} payouts</button>
    </div>
    <div>
      <div
        v-for="g in groups"
        :key="g.role"
        class="tr-role-bucket"
        :class="{ 'is-drop-target': dragTargetRole === g.role }"
        :data-role="g.role"
        @dragover="onDragOver($event, g.role)"
        @dragleave="onDragLeave(g.role)"
        @drop="onDrop($event, g.role)"
      >
        <div class="tr-role-head">
          <input type="text" class="role-name" :value="g.role" @change="renameRole(g, ($event.target as HTMLInputElement).value)" />
          <span class="count">{{ g.members.length }} · {{ g.activeCount }} active</span>
          <span class="total-amt">{{ money(g.roleTotal) }}/mo</span>
        </div>
        <div
          v-for="t in g.members"
          :key="t.id"
          class="tr-member-row"
          :class="{ 'is-founder': t.isFounder }"
          :data-id="t.id"
        >
          <span
            class="tr-drag"
            draggable="true"
            :title="`Drag to move ${t.name} to another role`"
            @dragstart="onDragStart($event, t)"
            @dragend="onDragEnd"
          >⠿</span>
          <input type="text" class="name" :value="t.name" placeholder="Member name" @change="setName(t, ($event.target as HTMLInputElement).value)" />
          <div class="amt-wrap">
            <span class="amt-sym">£</span>
            <input type="number" class="amt" step="0.01" min="0" :value="t.amount || 0" placeholder="0.00" @change="setAmount(t, ($event.target as HTMLInputElement).value)" />
          </div>
          <div class="tr-paytype-toggle">
            <button type="button" data-type="salary" :class="{ active: t.payType === 'salary' }" @click="setPayType(t, 'salary')">Salary</button>
            <button type="button" data-type="commission" :class="{ active: t.payType === 'commission' }" @click="setPayType(t, 'commission')">Commission</button>
          </div>
          <button
            type="button"
            class="tr-founder-toggle"
            :class="{ active: t.isFounder }"
            :title="t.isFounder ? 'This is the founder. Click to unset.' : 'Mark as founder. Only one founder allowed — Founder bucket items prefill with this name.'"
            @click="toggleFounder(t)"
          >👑</button>
          <button
            type="button"
            class="tr-active-toggle"
            :class="{ inactive: t.active === false }"
            :title="t.active !== false ? 'Active — click to deactivate' : 'Inactive — click to activate'"
            @click="toggleActive(t)"
          >{{ t.active !== false ? '✓' : '−' }}</button>
          <button type="button" class="del" @click="delMember(t)">×</button>
        </div>
        <button type="button" class="tr-role-add-member" @click="addMember(g.role)">+ Add member to {{ g.role }}</button>
        <div class="tr-drop-hint">Drop here to assign to <b>{{ g.role }}</b></div>
      </div>
    </div>
  </div>
</template>
