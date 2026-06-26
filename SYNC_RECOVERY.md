# Cross-user sync fix + recovering Joanna's data

## What was actually broken

Two separate problems caused "we can't see each other's changes" and "Joanna's data is missing":

1. **The backend was rejecting the dashboard's domain.** Sync goes through team-tracker's
   `/api/external/kv/[key]` endpoint, which only allows an explicit list of origins.
   `https://businessdashboard.agencyadvanta.com` was **not on the list**, so every sync call
   returned `403 origin not allowed`. Each browser fell back to "Offline (local only)" and only
   ever saw its own `localStorage`. **Joanna's data was never lost — it's stranded in her browser
   (and/or sitting on the server from the old GitHub-Pages days).**

2. **Sync replaced the whole document (last-write-wins).** Even once #1 is fixed, the old code
   overwrote the entire remote/local state on each sync. With two editors, the last save wins and
   the other person's edits vanish. This is now a **field-level union merge** that never drops an
   entry from either side ([src/lib/merge.ts](src/lib/merge.ts)).

## Code changes in this fix

- `team-tracker/web/app/api/external/kv/[key]/route.ts` — added the dashboard's production domain
  and Vite dev origins to `ALLOWED_ORIGINS`.
- `business-dashboard/src/lib/merge.ts` — new union-by-id merge (never drops data; resolves
  same-entity conflicts by per-entity timestamp, else newest-blob tiebreak).
- `business-dashboard/src/lib/cloud.ts` + `src/stores/dashboard.ts` — pulls now MERGE and push the
  union back, instead of wholesale replace.

## Rollout + recovery — do these in order

> ⚠️ Until **both** users are on the new build, do NOT rely on sync — an old-build push can still
> clobber the server. Back up first (step 3).

1. **Redeploy team-tracker** so the allow-list change goes live (the endpoint that serves sync).
2. **Deploy the new dashboard build** (`npm run build` → publish `dist/`) to
   `businessdashboard.agencyadvanta.com`.
3. **Both users: back up before touching sync.** Open the app → Settings → **Export JSON**, save the
   file somewhere safe. This is the safety net.
4. **Verify both users share the SAME workspace key.** Settings → Cloud sync → the *workspace key*
   must be **identical** for Josiah and Joanna. Different keys = separate buckets = they'd never see
   each other even with CORS fixed. (Pick whichever key already has the most data; set the other
   device to match it.)
5. **Converge the data.** With matching keys and the new build, just enabling sync is enough — the
   30s poll pulls + merges automatically. To force it immediately, each user clicks
   **Pull now** then **Push now** in Settings → Cloud sync. The merge unions everyone's entries;
   nothing is overwritten.
6. **Verify.** Both users should now see the same months, expenses, team, invoices, and budgets.
   Spot-check a couple of Joanna's known entries.

## If Joanna's data is ONLY in her browser (never reached the server)

Step 5 handles this automatically (her app merges + pushes her local rows). If for some reason her
device can't sync, she can Settings → **Export JSON** on her machine, send the file to Josiah, and he
can Settings → **Import JSON**. Import now defaults to **Merge** (combine, nothing overwritten) — the
safe recovery path — with Replace still available for a deliberate full restore.

## Deletes now propagate (tombstones)

Deleting an entry records a tombstone (`${collection}:${id}` → time) that travels with the merge, so a
delete on one device removes the entry everywhere instead of being resurrected by the union
([src/lib/merge.ts](src/lib/merge.ts), [src/stores/dashboard.ts](src/stores/dashboard.ts)). Rules:

- A tombstone beats a concurrent edit to the same entry (**delete wins**) — predictable for a small team.
- **Bulk operations are local-only and never emit tombstones:** Reset to backfill, Wipe all data, and
  Import → Replace rebase the tombstone baseline and do **not** push, so they can't mass-delete the
  shared dataset. The next pull re-merges the server's data back in. For a deliberate hard restore,
  turn cloud sync **off** first, replace, then turn it back on.
- Individual deletes (one expense, one team member, one month, …) **do** propagate.
