// Expense bucket + category definitions — ported verbatim from the legacy app.
import { S } from './store-access'
import type { CustomBucket } from '@/types'

export const CATEGORY_ORDER = [
  'Base Software',
  'LinkedIn Channel',
  'Email Channel',
  'SMS',
  'One off',
  // Newer line-item buckets — same shape as the originals.
  'Founder comp',
  'Referral payouts',
  'Merchant fees',
]

export interface BucketDef {
  id: string
  name: string
  icon?: string
  color: string
  kind: 'expense' | 'team' | 'refund'
  categoryMap?: string
  fallbackMonthField?: string
}

export const FH_DEFAULT_BUCKETS: BucketDef[] = [
  { id: 'base', name: 'Base Software', icon: '⚙️', color: '#5e9eff', kind: 'expense', categoryMap: 'Base Software' },
  { id: 'linkedin', name: 'LinkedIn Channel', icon: '💼', color: '#bf5af2', kind: 'expense', categoryMap: 'LinkedIn Channel' },
  { id: 'email', name: 'Email Channel', icon: '✉️', color: '#64d2ff', kind: 'expense', categoryMap: 'Email Channel' },
  { id: 'sms', name: 'SMS Channel', icon: '📲', color: '#ff9f0a', kind: 'expense', categoryMap: 'SMS' },
  { id: 'oneoff', name: 'One off', icon: '✨', color: '#ff9500', kind: 'expense', categoryMap: 'One off' },
  { id: 'team', name: 'Team & Payouts', icon: '👥', color: '#30d158', kind: 'team' },
  { id: 'founder', name: 'Founder compensation', icon: '👑', color: '#d4a017', kind: 'expense', categoryMap: 'Founder comp', fallbackMonthField: 'founderComp' },
  { id: 'referrals', name: 'Referral payouts', icon: '🤝', color: '#ff8a3d', kind: 'expense', categoryMap: 'Referral payouts', fallbackMonthField: 'referralPayoutsTotal' },
  { id: 'merchant', name: 'Merchant / Stripe fees', icon: '💳', color: '#7c8aa3', kind: 'expense', categoryMap: 'Merchant fees', fallbackMonthField: 'merchantFees' },
  { id: 'refunds', name: 'Refunds', icon: '↩️', color: '#ff453a', kind: 'refund' },
]

export function fhAllBuckets(): BucketDef[] {
  return [
    ...FH_DEFAULT_BUCKETS,
    ...((S().customBuckets || []) as CustomBucket[]).map((b) => ({ ...b, kind: b.kind || 'expense' }) as BucketDef),
  ]
}
