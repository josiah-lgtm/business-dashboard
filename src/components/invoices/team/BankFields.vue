<script setup lang="ts">
// Country-aware profile + bank-details form for a single team member.
// Ports renderTiProfileForm + wireTiProfileForm. Edits mutate the member
// in store.state directly (the store autosaves). Changing country swaps the
// bank field set reactively.
import { computed } from 'vue'
import { TI_COUNTRIES, TI_BANK_LABELS, tiCountry } from '@/lib/countries'
import type { TeamMember } from '@/types'

const props = defineProps<{ member: TeamMember }>()

const country = computed(() => tiCountry(props.member.country))

function onBankInput(field: string, value: string) {
  if (!props.member.bank) props.member.bank = {}
  props.member.bank[field] = value
}
</script>

<template>
  <div class="ti-profile-form">
    <div><label>Name</label><input type="text" v-model="member.name" /></div>
    <div><label>Role</label><input type="text" v-model="member.role" /></div>
    <div><label>Email</label><input type="email" v-model="member.email" /></div>
    <div>
      <label>Country</label>
      <select v-model="member.country">
        <option v-for="co in TI_COUNTRIES" :key="co.code" :value="co.code">{{ co.name }}</option>
      </select>
    </div>
    <div class="span-2">
      <label>Address (multi-line)</label>
      <textarea v-model="member.address" rows="2" placeholder="Street, City, Postcode, Country"></textarea>
    </div>
    <div class="span-2" style="margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--separator)">
      <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 8px">
        {{ country.name }} bank details
      </div>
      <div class="ti-profile-form" style="margin-top: 0">
        <div v-for="f in country.fields" :key="f">
          <label>{{ TI_BANK_LABELS[f] || f }}</label>
          <input
            type="text"
            :value="(member.bank || {})[f] || ''"
            @input="onBankInput(f, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
