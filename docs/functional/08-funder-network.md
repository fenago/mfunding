# 8. The Funder Network

Funders are the business. Everything else is logistics.

---

## 8.1 The funder journey

A funder moves through these statuses. Only one of them means "we can actually submit deals here."

| Status | Meaning |
|---|---|
| **Potential** | Identified. We haven't applied yet. |
| **Application Submitted** | Our ISO/broker application is with them. |
| **Processing** | They're reviewing us. |
| **Approved** | Approved as an ISO partner, not yet actively submitting. |
| ✅ **Live Vendor** | **The only status that matters operationally.** Live funders are the only ones that appear in the approval matrix, the funder matching engine, and the AI recommendations. |
| **Rejected** / **Inactive** | Dead relationship. Kept for history. |
| **Affiliate Referral** | A pass-through/referral relationship, not a full submission workflow. |

---

## 8.2 Onboarding a funder — the procedure

1. **Find them.** Start on **Funder Directory** (`/admin/funder-directory`) — the researched
   prospect list, split by category (marketplace, ISO white-label, low-revenue, mainstream,
   platform, direct). Anything already in the network shows **"In system."** Junk can be hidden;
   notes can be pinned to any entry.
2. **Promote them.** **Add to lenders** pulls their criteria into a real lender record and lets you
   set the starting status. Or add one from scratch on **Lenders → Add Lender**.
3. **Let the AI fill it in.** On the lender's detail page, the **AI Extract** tab scrapes their
   website and fills 25+ fields — products, paper tier, funding range, minimum time in business,
   revenue and credit minimums, commission, factor-rate range, term lengths, stacking policy,
   restricted industries and states, submission email/portal, contacts. **Nothing is saved until you
   click "Apply to Lender."** Review it first; websites lie.
4. **Apply to them.** Send their ISO application. Set the status to **Application Submitted**.
5. **When they approve you**, set them to **Live Vendor** and fill in the two things that make them
   actually usable:
   - the **MCA Approval Criteria** (approval range, min credit, min revenue, min time in business,
     doc requirements) — this is what the matching engine and the approval matrix read;
   - the **submission recipe** (below) — this is what the submission engine executes.

**Funder Matrix** (`/admin/funder-matrix`) shows every live funder's criteria side by side, editable
right in the grid. Filter it by "needs voided check," "needs photo ID," "needs tax return,"
"accepts if-applicable CC."

**Funder Guide** (`/admin/funder-guide`) is the read-only version — who's live, who's pending, who's
a prospect — plus the universal submission packet and the deal-routing cheat sheet. **Closers can
open this one.**

---

## 8.3 The submission recipe — how each funder wants their file

Every funder gets their file **their way**. The recipe lives on the lender's detail page and it's
what the submission engine actually executes.

| Setting | What it controls |
|---|---|
| **Method** | **Email**, **Portal**, or both. Almost every funder is email. |
| **To / CC** | Where the package goes. |
| **Subject & body templates** | The email itself, with merge fields — business name, owner, EIN, amount requested, monthly revenue, time in business, industry, use of funds, positions, deal number, closer name, the document links. |
| **Attach docs** | Which documents go in the package. Typical: the **application** + **bank statements**. |
| **Attachment mode** | Real file attachments, secure download links, or both. |
| **Max statement months** | How many months of statements to send (default **4**; some funders want 3). |
| **Required stips** | ⚠️ **A hard gate.** Any document on this list that isn't on file **blocks submission to that funder** — the checkbox greys out with *"⚠ needs: …"*. |
| **Portal URL + steps** | For portal funders: the link, the numbered steps, and a credentials hint. |
| **Special instructions** | Free text, appended to every email. **This is where their real underwriting guidelines live** — e.g. *"min $20K/mo revenue, 8mo TIB, 500 FICO, up to 3rd position, NON-STACKABLE, min 5 deposits/mo. Restricted: law firms, lending platforms…"* Read it before you submit. |

**No recipe? Nothing breaks.** A funder with no recipe still gets a generic email with the
application and bank statements attached. It just isn't personalised. **Most funders in the network
are currently on the generic default** — only a handful have full custom recipes with hard stip
gates. Building recipes out is high-leverage work.

---

## 8.4 Submitting a deal — how it actually works

**Who can do it:** the closer who owns the deal, or an admin/owner. Enforced on the server, not just
in the menus.

### 1. Matching
The platform scores every live funder against the deal — product type, paper tier, credit minimum,
funding range, revenue minimum, time in business — and shows the strong matches first, with weaker
ones behind a "show lower-match funders" link.

### 2. The AI recommendation (optional but do it)
**"AI: recommend lenders"** gives you a ranked short-list with a **fit** badge (strong / possible /
poor), the **reasons**, and the **watch-outs**.

> **The AI does not decide who qualifies.** Qualification is computed in code against each funder's
> hard minimums. The AI only ranks and explains. And it does it **twice** — once against the revenue
> the merchant *told* you, and once against the revenue their **bank statements actually show** —
> and it flags loudly when the answer **"flips on verified."** That flag is the single most valuable
> thing on the screen. Believe the statements.

Strong-fit funders that are eligible get pre-ticked for you.

### 3. The gates
- 🔴 **The signed application PDF must be on file.** This is the one universal hard gate. No signed
  app, no submission — to anyone. Download the completed PDF from the CRM once and upload it, and it
  **unblocks every funder at once**.
- 🟡 **Per-funder required stips.** A funder whose recipe demands a tax return you don't have is
  greyed out — but the others are still submittable.
- ✅ **A voided check never blocks anything, anywhere.** A screenshot of their bank portal satisfies
  it.

### 4. Submit
Pick **3–5 funders** and hit submit. For each one, in one click:

- The package is built to **that funder's recipe** — their documents, their attachment mode, their
  statement count, their email template, their special instructions, plus the AI business summary.
- **Email funders** get the email, with real attachments and/or secure 72-hour download links.
- **Portal funders** get no email — instead you're handed the **portal URL, the numbered steps, and
  the credentials hint** to do it by hand. When you've done it, click **Mark submitted**.
- Anything already submitted is **skipped, not duplicated** (unless you explicitly resend).
- Every send, block, resend, and portal action is written to the deal's activity log.

**Submitting does not advance the deal's stage.** That stays a deliberate, separate click — so a
partial fan-out never strands a deal in the wrong place.

---

## 8.5 Funder replies

**They come back automatically.** The platform reads each funder's inbound email and classifies it:

| Type | What happens |
|---|---|
| **Offer** | The submission flips to **Offer Made**, with whatever amount / factor / term it could read. |
| **Decline** | The submission flips to **Declined**, with the reason category (low revenue, industry, time in business, credit, existing positions, missing docs, state, other). |
| **Stip request** | The items they're asking for are captured. |
| **Question** / **Acknowledgment** | Captured and summarised. |

Merchant replies are summarised too — that's what puts a **💬 Merchant replied** card on My Day.

### The funder responses board (on the deal)

One card per funder that's actually gone out, moving through **⏳ Awaiting → ✉ Replied → 💰 Offer →
✅ Accepted / 🙅 Merchant declined**, or **❌ Funder declined / ↩ Withdrawn**.

What you can do from it:

| Action | What it does |
|---|---|
| **Log offer** | Amount, factor, term, payment. Auto-computes the total payback **and warns you if the payment is more than 15% of their monthly revenue.** Offers are ranked cheapest-payback-first with a 🏆 on the best value. |
| **Funder declined** | Record the decline and the reason. |
| **Mark accepted / declined** | On a logged offer. |
| **Reopen** | The funder changed their mind after an auto-applied decline. |
| **Withdraw** | Pull the file back with a courteous note. |
| **Send thank-you** | A one-time courtesy note on a decline. Relationships are the business. |
| **Message funder / merchant** | Free-form follow-up with deal documents attachable — this is how you answer a stip request. |
| **View email** | Read the funder's original message in full. |

### Reconciling replies from unknown addresses

A funder often replies from a person's own address, not the one you submitted to — so it arrives as
an unknown sender. **Funder Contacts** (`/admin/funder-contacts`, admin+) fixes that:

1. Click **Scan for funder replies**. It matches each unknown sender's **email domain** against
   every funder's website and submission addresses, and reads their signature for a name, title, and
   phone.
2. Review the proposals, edit anything wrong, tick the ones to keep, and hit **Apply selected**.
3. The contact is saved to the funder — and **every future reply from that person auto-associates
   from then on.**

There's a matching panel for **unmatched inbound phone numbers**: tie a number to a funder once and
it's known forever.

---

## 8.6 The internal underwriter

Before you spend submissions, run it. It **reads the merchant's actual bank statement PDFs** and
gives you:

- **True revenue vs. reported revenue** — and the padding between them.
- **NSF count** and **negative days**.
- **Estimated open MCA positions** and their existing daily debit.
- **Affordability** — the maximum daily/weekly payment and advance size they can actually sustain,
  on both a normal and a conservative basis.
- A **risk rating** (low / medium / high), a written narrative, and a note on which funders fit.

This is the ground truth the rest of the system leans on. The scoring weights behind the
Approve / Review / Decline recommendation are tunable on **Platform Config**.
