# PLAN — Lead Scoring & Ranking ("work the best leads first")

**Status:** plan only — nothing in this document is built yet.
**Owner's ask:** every lead gets a rating/ranking — likelihood to close, the money at stake — so closers work the best leads first.
**Honesty up front:** the repo has **17 non-VCF deals and 0 funded** (verified against the live DB, project `ehibjeonqpqskhcvizow`, 2026-07-13). There is **no ground truth to train on**. v1 is a transparent rules-based score whose weights are judgment calls; the plan's second half defines exactly what gets logged now so a v2 can be *calibrated on real outcomes* later instead of guessed again.

---

## 1. What we're ranking, and why it's two numbers, not one

Two different questions get conflated in every naive "lead score":

1. **When should I act?** — urgency. `MyDayQueue.tsx` already answers this with its rank ladder (live transfer > callback due > funder replied > … ). It is SLA-driven and correct. **We do not touch it.**
2. **Which lead is worth more of my energy?** — quality. This is the new thing.

And quality itself is two numbers:

- **`close_score` (0–100) → grade A/B/C/D** — how likely is this lead to fund, judged from what we know right now. Explainable, rules-based.
- **`expected_value` ($)** — `P(close) × expected commission`. This is the true sort order for "best first": a 40% shot at a $100k deal ($3,200 EV at 8 pts) beats an 80% shot at $15k ($960 EV). Grade alone would rank those backwards.

**Reconciliation rule (the non-mushy answer):** urgency decides *order of the queue*; quality decides *ties and investment*. Concretely: My Day keeps sorting by `rank asc`, and within an identical rank, by `expected_value desc`, then `since asc`. A D-grade live transfer still sits above an A-grade stale-docs chase — the phone is ringing — but when five docs-chases are equally urgent, the closer chases the $6k one first. No blended number, ever.

---

## 2. The inputs — all verified to exist today

| Input | Where it lives | Notes |
|---|---|---|
| Monthly deposits (stated) | `deals.lead_qual.monthly_deposits`, mirrored to `customers.monthly_revenue` | 100% populated on Synergy leads (`live-transfer-intake` LABEL_DEFS) |
| Requested amount | `deals.amount_requested` / `lead_qual.requested_amount` | |
| FICO (self-reported) | `lead_qual.fico`, `customers.credit_score_range` | |
| Industry, state | `lead_qual.industry` / `.state`, `customers.industry` | |
| Time as owner | `lead_qual.time_as_owner`, `customers.time_in_business` (months) | |
| Open positions + balances | `lead_qual.open_positions`, `.positions_balance` | |
| Use of funds | `deals.use_of_funds` | |
| Needs money now | `lead_qual.need_money_now` | |
| Processes cards / equity / property paid down / difficulty approved | `lead_qual.processes_cc`, `.has_equity`, `.property_paid_down`, `.difficulty_approved` | |
| Funder-fit engine | `src/components/admin/FunderQualifier.tsx` — `evaluate()`: per-program gates (revenue floor, TIB, FICO, min-advance-vs-revenue) + 70–120% sizing band | **The strongest close signal we have today**: "how many live funders can actually take this deal" |
| Stage baseline odds | `src/config/funnelOdds.ts` — `FUND_ODDS` (targets, not history; labelled as estimates) + `MIN_RELIABLE_N = 20` | |
| Measured conversion | `src/components/admin/StageConversion.tsx` | n far too small — a trained model is impossible right now; this plan says so |
| Underwriting truth | `deal_underwriting` (`metrics`, `flags`, `risk_rating` low/med/high, `affordability_rating`, versioned) from `underwrite-deal` | Arrives only after statements. Victor Nguyan: stated $19k/mo, true $10.9k, verdict decline — the score must re-rank on this |
| Commission math | `src/types/commissions.ts` — `expectedCommissionInPlay()` (8 pts new / 6 pts renewal), splits | |
| Email health | `customers.email_status` (`ok` / `bounced` / null, stamped by `check-email-bounces`) | A dead email is a strong negative already stored |
| Funder responses | `deal_submissions.response_at` + statuses (used by MyDayQueue) | Declines shrink the live-funder count; an offer is near-certainty |

---

## 3. The v1 formula — rules-based, every point explainable

### 3.1 `close_score` (0–100)

Each factor emits `{factor, points, max, note}`. The notes ARE the explanation the UI shows — "B because revenue supports the ask, 21 live funders match, no positions" is literally the top three notes concatenated. Never a black box.

| Factor | Max | Rule (v1 judgment — logged for recalibration) |
|---|---|---|
| **Funder fit** | **40** | Run the shared `evaluate()` against active `lender_programs` (mca, live_vendor). `likely` count L: L=0 → 0 pts **and hard-cap grade at D** (nobody can fund it = it cannot close); L=1–3 → 15; L=4–9 → 28; L≥10 → 40. Note: "`{L}` live funders can take this deal". |
| **Ask realism** | **15** | multiple = requested ÷ monthly revenue (same math as FunderQualifier). ≤1.2× → 15 ("ask is in range"); ≤1.5× → 8 ("a stretch — expect a resize conversation"); >1.5× → 0 ("2.5× revenue — expectation reset required"). |
| **Fundamentals** | **20** | Revenue band: ≥$50k/mo → 8, ≥$20k → 6, ≥$10k → 3, else 0. TIB: ≥24mo → 4, ≥12 → 2, ≥6 → 1, else 0. FICO: ≥650 → 4, ≥600 → 3, ≥550 → 1, unknown → 1, <550 → 0. Positions: 0 → 4, 1–2 → 2, ≥3 or balance >50% of monthly revenue → 0 ("stacked"). |
| **Intent** | **15** | need_money_now yes → 6. Use of funds revenue-generating (expansion/equipment/inventory/marketing) → 5; payoff/consolidation → 2; unknown → 2. difficulty_approved "no" → 2. Source temperature hot/live → 2. |
| **Reachability** | **10** | email_status `ok` → 4, null → 2, `bounced` → 0. Phone present → 4. best_time given → 2. **Hard rule: bounced email AND no phone → force D** (we cannot close someone we cannot reach). |

**Post-underwriting overrides** (when a `deal_underwriting` row exists — bank-statement truth beats stated numbers):
- True monthly revenue (from `metrics`) **replaces** stated deposits in Funder fit + Ask realism. This is what demotes a Victor Nguyan automatically.
- `risk_rating = high` or any critical flag → cap grade at C; an explicit decline-shaped result (e.g. affordability below any funder's minimum) → force D. Note: "underwriting: true revenue $10.9k vs stated $19k".
- `risk_rating = low` and clean flags → +5 bonus (capped at 100), note "statements verify the story".

**Funder-response overrides:** every submission decline re-runs Funder fit with that funder excluded; an offer received → floor the grade at B ("a funder already said yes").

### 3.2 Grades

| Grade | Score | Meaning on the floor |
|---|---|---|
| **A** | ≥ 80 | Fund-ready profile — drop what's tied and work this |
| **B** | 65–79 | Solid — normal cadence |
| **C** | 45–64 | Workable with a resize/repair conversation |
| **D** | < 45 (or any hard-cap) | Long shot — automation-first, minimal closer minutes |

### 3.3 `expected_value`

```
fundable_amount     = min(amount_requested, monthly_revenue × ADVANCE_CEILING_PCT)   // 1.2, from funnelOdds.ts — size off revenue, never the aspiration
                      (post-underwriting: min further with the affordability max advance)
expected_commission = fundable_amount × 8% (6% if is_renewal)                        // expectedCommissionInPlay() semantics
P(close)            = clamp( FUND_ODDS[status] × GRADE_MULT[grade], 0.01, 0.95 )
GRADE_MULT          = { A: 1.5, B: 1.0, C: 0.6, D: 0.25 }                            // judgment; logged
expected_value      = P(close) × expected_commission
```

`FUND_ODDS` are already labelled estimates everywhere they render; EV inherits that label ("est."). The stage term means EV *rises as the deal advances* — a B at offer_received outranks an A at new for chase priority, which is correct: money nearer the door.

---

## 4. Storage — recommendation: columns on `deals` + an append-only event log

**Recommended: both, with different jobs.**

1. **Current score → columns on `deals`** (read join-free by My Day, deals list, context bar):
   - `lead_grade text` (A/B/C/D), `lead_score numeric`, `expected_value numeric`, `score_reasons jsonb` (the factor array), `score_version int`, `scored_at timestamptz`.
2. **History → new `lead_score_events` table** (append-only; INSERT on every recompute): `id, deal_id, version, trigger` ('intake'|'qual_update'|'underwriting'|'funder_response'|'email_health'|'sweep'|'manual'), `inputs jsonb` (full snapshot: stated + underwritten numbers, likely-funder count, every factor's points), `score, grade, expected_value, created_at`.

Why not a single `lead_scores` table for both: the hot read path (My Day polls every 15s) shouldn't need a lateral join to "latest score per deal"; and a mutable side-table gives you neither fast reads nor history. Columns give speed; the event log gives the v2 training set (§7).

## 5. Compute — one shared pure function, one edge function

- **`supabase/functions/_shared/leadScore.ts`** — pure `scoreLead(inputs) → {score, grade, ev, reasons}`. The funder-gate logic is extracted from `FunderQualifier.evaluate()` into this shared module so the qualifier UI and the score can never disagree (mirror or re-export into `src/lib/leadScore.ts` for the frontend, same keep-in-sync pattern as `SELF_GEN_LEAD_SOURCES`).
- **`score-lead` edge function** — loads deal + customer + programs + latest underwriting + submissions, calls `scoreLead`, writes the `deals` columns + one `lead_score_events` row. Idempotent per (deal, inputs-hash).

**Recompute triggers** (each caller invokes `score-lead` fire-and-forget):
1. **Intake** — `live-transfer-intake`, `mca-intake`, `contact-intake`, `bulk-lead-import` after deal create.
2. **Qualification updates** — when revenue/FICO/TIB/positions/requested change (playbook qualify step + MerchantApplicationModal save paths).
3. **Underwriting lands** — end of `underwrite-deal` after the `deal_underwriting` insert. This is the re-rank moment.
4. **Funder responses** — `funder-reply-reconcile` / `poll-funder-replies` after a submission status change.
5. **Email health** — `check-email-bounces` when it stamps `bounced`.
6. **Nightly pg_cron sweep** — catches anything missed + rescores on `score_version` bumps.

## 6. Display

- **My Day card chip** (`MyDayQueue.tsx`): small grade chip + EV next to the ask — `A · $4.2K est.` Tooltip = top 3 reason notes. Sort change: `rank asc → expected_value desc → since asc` (quality as tiebreaker only; lanes and ranks untouched).
- **Playbook context bar** (`DealContextBar` in `PlaybooksPage.tsx`): grade chip + one-line why ("B — revenue supports the ask, 12 live funders, 2 open positions") with a popover showing the full factor table.
- **Deals list** (`DealListPage.tsx`): Grade + EV columns; new default sort option "Best first (EV)".
- Everywhere: the chip carries "est." and the tooltip's last line reads *"v1 rules score — weights are judgment until we have funded-deal history."*

## 7. Honesty rails — what gets logged NOW so v2 can be real

- **No ground truth exists**: 0 funded deals; `StageConversion` suppresses rates below `MIN_RELIABLE_N = 20`. v1 weights are explicitly judgment and versioned (`score_version = 1`).
- **The calibration dataset is the event log**: every `lead_score_events` row snapshots ALL inputs + factor points at score time; when a deal hits a terminal state (funded / declined / dead / nurture) a `terminal_outcome` backfill joins outcomes to snapshots.
- **Intermediate labels too**: funded will stay rare for months, so also log proxy outcomes (reached submitted, offer received, offer accepted) — factor weights can be sanity-checked against "did it at least get an offer" long before n(funded) ≥ 20.
- **v2 trigger**: once ≥ 50 terminal outcomes (or ≥ 20 funded), fit a simple logistic regression on the logged snapshots, compare against v1 per-grade hit rates, and only then replace weights — bumping `score_version` so old and new scores are never mixed in analysis.
- **Never present v1 as measured**: same rule StageConversion already enforces in code.

## 8. Build order

1. Migration: `deals` score columns + `lead_score_events` table (+ RLS matching `deals`).
2. `_shared/leadScore.ts` (extract funder-gate logic) + `score-lead` edge function + backfill the 17 existing deals.
3. Wire the six recompute triggers.
4. UI: My Day chip + tiebreak sort, context bar chip, deals list columns/sort.
5. Terminal-outcome backfill + a tiny "score audit" view (grade vs proxy outcomes) so drift is visible from day one.

---

## TODO entries

- [ ] Lead scoring — migration: `deals.lead_grade/lead_score/expected_value/score_reasons/score_version/scored_at` + append-only `lead_score_events` table (RLS mirrors `deals`)
- [ ] Lead scoring — extract FunderQualifier's `evaluate()` gate/sizing logic into shared `_shared/leadScore.ts` + `src/lib/leadScore.ts` (keep-in-sync note, same pattern as SELF_GEN_LEAD_SOURCES)
- [ ] Lead scoring — build `score-lead` edge function (pure `scoreLead()` + writes columns + logs event row); backfill all existing non-VCF deals
- [ ] Lead scoring — wire recompute triggers: intake fns, qualification saves, end of `underwrite-deal` (the re-rank moment), funder-reply reconcile, `check-email-bounces`, nightly pg_cron sweep
- [ ] Lead scoring — My Day: grade+EV chip on cards, tooltip with reason notes, sort becomes rank → EV desc → since (urgency untouched, quality tiebreaks only)
- [ ] Lead scoring — DealContextBar grade chip + reasons popover; DealListPage Grade/EV columns + "Best first (EV)" sort
- [ ] Lead scoring — terminal-outcome backfill job + score-audit view (grade vs proxy outcomes: reached-submitted / offer-received / funded) so v2 calibration data accrues from day one
- [ ] Lead scoring v2 (LATER — blocked on data): once ≥50 terminal outcomes, fit logistic weights from `lead_score_events`, bump `score_version`
