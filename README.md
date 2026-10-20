# Home Printing Service

Next.js 14 (App Router, TypeScript) + Supabase. Customers upload a PDF and place a **cash** order for pickup or delivery. The owner manages orders in a protected **admin dashboard**. Online payment, order tracking, scanner and AI checks are **not built yet**.

## Run locally
```bash
npm install
cp .env.example .env.local     # fill in (see below)
npm run dev                    # http://localhost:3000
npm test                       # 93 tests (logic + SQL on embedded Postgres); no network or Supabase needed
npm run lint                   # type check
npm run build && npm start
```
Without Supabase credentials the public site still runs; ordering and the admin area answer "not set up yet" (HTTP 503). Nothing is faked.

## 1. Supabase setup
1. Create a project at supabase.com.
2. SQL Editor → run, **in order**: `supabase/migrations/0001_init.sql`, `0002_uploads.sql`, `0003_admin.sql`, `0004_queue.sql`, **`0005_catalogue.sql`**. (0003 tightens security, 0004 enforces the order status rules inside the database, 0005 adds paper sizes, printers and per-size prices. Do not skip any. **Run 0005 before deploying this version of the code**: without it the site keeps working as A4-only, but admin catalogue edits are refused.)
3. Project Settings → API: copy the URL, anon key and service-role key.

## 2. Environment variables
| Variable | Secret? | Purpose |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | no | Project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | no | Browser key: the Supabase **publishable** key (`sb_publishable_…`), or the legacy `anon` key. Used for admin sign-in and signed file uploads |
| SUPABASE_SERVICE_ROLE_KEY | **YES** | Server only: the Supabase **secret** key (`sb_secret_…`), or the legacy `service_role` key. Bypasses RLS. Powers orders, admin actions, file links |
| CRON_SECRET | **YES** | Protects `/api/cron/cleanup` |
| NEXT_PUBLIC_SITE_URL | no | Not used by the code yet; you can leave it unset |
| RAZORPAY_* | YES | Reserved; payments not implemented |

## 3. Admin account setup
1. Supabase → Authentication → Users → **Add user** (email + strong password, tick "auto confirm"). Authentication → Providers → **disable "Allow new users to sign up"** so strangers cannot create accounts.
2. Authorise that user (SQL Editor):
   `insert into public.admin_users (user_id) select id from auth.users where email = 'YOU@EXAMPLE.COM';`
3. Open `/admin/login` and sign in. A user who exists in Supabase but is **not** in `admin_users` is refused everywhere.
4. To remove an admin: `delete from public.admin_users where user_id = '…';` (their session stops working on the next request).
5. Turn on MFA/strong passwords in Supabase Auth settings if available on your plan.

## How admin security works
- **Server-side only.** Sign-in sets HttpOnly, SameSite=Strict (+Secure in production) cookies. *Every* `/api/admin/*` call verifies the token with Supabase Auth **and** checks `admin_users`; failure is 401/403, backend failure is 503 (fails closed). The `/admin` pages redirect for convenience but are not what protects the data.
- **CSRF:** state-changing requests must carry a same-origin `Origin` header.
- **No browser writes:** migration 0003 removes the old "admin all" write policies and revokes INSERT/UPDATE/DELETE from `anon`/`authenticated`. Admins can *read* tables through RLS; all writes go through `SECURITY DEFINER` functions executable **only by the service role**, each writing an audit entry in the same transaction.
- **Files:** bucket is private; the old admin read policy on storage was dropped, so files are reachable only through `/api/admin/files/<id>` → a **60-second signed URL**, logged as `file.viewed` / `file.downloaded`.
- **Cash:** one `cash_collections` row per order (unique). A DB trigger refuses `payment_status='paid'` for a cash order without a matching collection (even for service-role code). Cash can only be recorded when the order is *ready for pickup / out for delivery*, for the exact total, once.
- **Status rules:** forward-only (pending → confirmed → preparing → printing → ready/out for delivery → completed), cancel needs a reason, paid orders can't be cancelled (no refund flow yet), **completed requires cash collected**, stale clicks are rejected.
- **Audit log** is append-only (trigger blocks update/delete) and stores admin id + email, before/after for settings.
- Customers (anon or logged-in non-admins) have no table access beyond public settings, no admin API access, no file access.


## Paper sizes, printers and pricing (new)
**What changed for you:** nothing visible until you switch things on. After migration 0005 the shop behaves exactly as before: **A4 only, colour ₹9 / B&W ₹2** (copied from your existing rates, whatever they currently are). A3, A5, Letter and Legal exist in the catalogue but are **disabled and unpriced**; no rate is invented for any size.

**Admin > Paper & printers (`/admin/catalogue`):**
- **Paper sizes:** switch a size on/off for customers and set its B&W and colour price per printed side. Add **custom sizes** (name + width × height in mm); they start hidden and unpriced. Leave a price empty to not offer that print type. A size can only be enabled if it has a price **and** an active printer that supports it. The last enabled size can't be switched off. Sizes are never deleted (old orders stay accurate).
- **Printers:** add any number. Each has a name, **active/inactive**, **colour** yes/no, **double-sided** yes/no and the **paper sizes it can print**. To start offering A3 later: add the large printer (A3 plus its capabilities), then enable A3 and set its prices. No code changes.
- The page warns about problems (e.g. an enabled size with no active printer, or a missing price).
- The seeded **"Main printer"** assumes **A4, colour and double-sided** because that is what your poster advertises. **Edit it if that is wrong** (e.g. untick colour or double-sided).

**What customers see:** a Paper size picker on Upload & Print. Disabled sizes are hidden; enabled sizes that no active printer can serve show as "currently unavailable". Colour / double-sided options are greyed out ("not available") when no single printer can do that combination for the chosen size, and the prices shown are for that size.

**Server-side validation (cannot be bypassed from the browser):** before any order is accepted the server checks that the size exists and is enabled, that **one active printer** supports the size *and* the requested colour and double-sided options together, and that a price exists for that size and colour mode; the total is computed from that size's price. An order with no `paperSize` is treated as A4 (older clients keep working). Browser-sent prices are still ignored.

**Saved with every order:** the paper size name and its **dimensions** (a snapshot, so later catalogue edits never rewrite history). Existing orders were backfilled as A4 (210 × 297 mm). The Orders page, print queue (with a paper filter and a "no active printer can do this job" warning) and job sheet all show it. Non-A4 jobs get "LOAD A3 PAPER" on the job sheet, plus a list of suitable active printers.

**Job sheets stay on A4:** the operational sheet always prints on A4 (`@page { size: A4 }`) whatever paper the customer chose; a test guards this.

**A4 rates stay in sync:** Settings > "A4 prices" and Paper & printers > A4 edit the same prices (the database functions mirror each other; tested). If a database error occurs while loading the catalogue, the server answers "temporarily unavailable"; it falls back to the old A4-only setup **only** when the catalogue tables genuinely don't exist.

## Print queue and job sheet
**`/admin/queue`** (admin only) lists orders that are *confirmed, preparing, printing, ready for pickup or out for delivery*, with **valid payment** (`cash_pending` or `paid`) and a **PDF still in storage**. New orders (`pending_confirmation`) are not printable until you confirm them under Orders; the queue shows how many are waiting. Orders that look active but can't be printed (e.g. the PDF was deleted by retention) are listed under "Not shown" with the reason.
- **Stages:** *Queued* = `confirmed`, then *Preparing*, *Printing*, then *Ready for pickup* (pickup orders) or *Out for delivery* (delivery orders), then *Completed*. These are the existing statuses and rules; no new states.
- **Next-order workflow:** a "Next up" card shows the job to do now (anything already printing first, then preparing, then the oldest queued) with one primary button for the next valid step, a Job sheet button and a View PDF button. B&W and colour **batch counters** help you group jobs.
- **Filter/sort:** stage tabs (To print / Hand over / All), status, print type (B&W / colour / mixed), pickup/delivery; sort by next-to-do, order time, status, print type or pickup/delivery (ascending/descending). Auto-refreshes every 30 s (paused while a dialog is open).
- **Hand over:** *Record cash* (exact total, once) is available here; **Mark completed** only appears once payment is recorded.
- **Duplicate/invalid changes:** every step sends the status the admin saw; if someone else already moved the order the change is refused ("Refresh and try again"). Skipping steps, going backwards, wrong handover type (delivery orders can't be "ready for pickup"), completing unpaid orders and cancelling paid orders are refused by the API **and by a database trigger** (migration 0004), even for privileged code.
- **Audit log:** each status change and cash record (`order.status_changed`, `order.cash_collected`, written by the database functions in the same transaction), each PDF view/download (`file.viewed`/`file.downloaded`) and each job sheet print (`job_sheet.print_opened`).

**Job sheet** `/admin/orders/<id>/job-sheet`: A4, black-on-white, no colour needed. Shows order number, print type (B&W/COLOUR/MIXED) in a box, order time, customer and phone, pickup/delivery (+ address for delivery only), payment line (e.g. "COLLECT CASH ON PICKUP ₹X" or "PAID"), per file: file name, colour, single/double-sided, copies, paper, **pages to print** (e.g. `1-3, 5`), printed sides and sheets, customer instructions, and an operator checklist. Totals use the same rules as the price calculator (tested). A cancelled order shows "CANCELLED: DO NOT PRINT" and the print button is disabled.
- **Printing:** the **Print job sheet** button opens your browser's normal print dialog (`window.print()`). **The website cannot silently control a printer** and does not know whether anything was actually printed; the audit entry says "print dialog opened". Choose your printer and A4 in the dialog.
- The customer's PDF is *not* embedded in the sheet. Open it with **View customer PDF** (same audited 60-second signed link as before; files stay private) and print it with the settings shown on the sheet.

## Admin screens
`/admin` dashboard (totals, pending, in progress, completed, cancelled, cash awaiting) · `/admin/orders` (search, filters, details, view/download PDF, status buttons with confirmation dialogs, cash collection, cancel with reason) · `/admin/queue` (print queue) · `/admin/settings` (rates, delivery on/off, fee, minimum, radius text, pickup, cash, max file size, retention).

## Customer ordering (unchanged)
Upload → server validates → cash order (`cash_pending`, `pending_confirmation`). See the code in `src/lib/orders.ts`. Delivery is offered only when the database says `enabled` **and** a valid fee is set. Cleanup cron: `/api/cron/cleanup` (daily via `vercel.json`).

## Deploy (Vercel)
Import repo → add the env vars → deploy. Run all five migrations on the production Supabase project first.

## VERIFIED (automated, local)
- 49 tests pass; TypeScript check passes; production build passes.
- **SQL on a real Postgres engine (PGlite) with Supabase `auth`/`storage` stubbed** (`src/lib/db.test.ts`): all three migrations apply; anon and non-admin users get nothing and cannot write; an admin session can read but cannot write directly; browser roles cannot call the admin functions; cash recording (wrong status/amount, duplicate, audit); paid-without-collection blocked by trigger; status function conflict + audit; settings function + audit + unknown key refused; audit log immutable.
- Auth logic with fakes: non-admin Supabase user forbidden, forged token, refresh, fail-closed on backend error, CSRF origin checks, cookie flags.
- Admin actions with fakes: status machine, cancel rules, completion needs payment, cash rules, signed-link + audit, settings validation/paise conversion/changed-keys-only, filter/search sanitising.
- **Queue/job sheet (new):** eligibility rules; filtering and every sort (incl. ties and descending); "next up" choice; batch counts; query whitelisting; next-action per status and fulfilment; full pickup workflow incl. cash-before-complete; delivery path; second-admin double-click refused; skipping steps refused; 401/403/200 on the queue, order and job-sheet endpoints and cross-site job-sheet logging refused; job-sheet numbers identical to the price calculator (pages, sides, sheets, duplex); page-range text, payment line, address only for delivery, unreadable range flagged. **SQL (PGlite):** migration 0004 trigger blocks skipped/backward moves, wrong handover type, unpaid completion, cancelling paid/terminal orders, even with privileged roles.
- **Paper sizes & printers (new):** every capability/price rule (colour and double-sided must be on ONE active printer; inactive printers, disabled sizes and missing prices refuse; nothing is guessed); the customer-visible catalogue (hidden vs unavailable); server-side order validation incl. per-size pricing, defaulting to A4, ignored browser prices, stale-price guard, junk ids; admin edits (custom sizes, enabling rules, last-size rule, printer add/update, validation); 401/403/200 on the catalogue endpoint and cross-site edits refused; job-sheet paper size/dimensions/non-A4 flag and the A4-only print CSS; queue paper column, filter and "no printer" warning; catalogue loading falls back only when tables are missing. **SQL (PGlite):** upgrade from migrations 0001-0004 keeps your A4 rates and backfills old orders; only A4 enabled/priced after upgrade; RLS (customers/anon see nothing, admins read but can't write); enabling refused without price or printer (and no partial writes); duplicate names; last-size rule; A4 mirror both ways; audit entries.
- Running server smoke tests: admin APIs return 503 without credentials, 401/403 for anonymous/forged requests (including when Supabase is unreachable), `/admin*` redirects to login, open-redirect attempt neutralised, no service key in browser bundle.

## NOT VERIFIED (needs your Supabase project and a real browser)
- Real Supabase Auth sign-in/refresh, the Supabase JS adapters (`admin-store-supabase.ts`: list/filter/join queries, RPC calls, signed URLs, storage), RLS on real Supabase (PGlite is Postgres but not Supabase itself).
- All admin screens and dialogs rendered in a browser / on phones; PDF upload thumbnails.
- **The job sheet's actual look on paper and the browser print dialog** (no browser available here). The print stylesheet is in the build (A4 `@page`, nav/buttons hidden, forced black-on-white) but I have not seen a printed page. Check A4 fit and that nothing spills to a second page.
- The Supabase query for the queue (`listQueueCandidates`) against a live project.
- The Supabase code for the catalogue (`loadCatalogue` and the three admin function calls) against a live project. The SQL itself is tested on Postgres, but PostgREST argument passing is not.
- The Paper & printers page and the customer paper-size picker in a browser or on a phone.
- Real printers: the site never talks to a printer; capabilities are whatever you enter.

## Manual test checklist (after setup)
**Paper sizes & printers (new)**
P1. Run 0005. In Paper & printers check A4 is enabled with your old rates and "Main printer" is listed (fix its colour/double-sided boxes if needed). The customer page shows only A4 at the same prices as before.
P2. Try to enable A3 with no price (refused), then with a price but no A3 printer (refused). Add a printer "Large" (A3, B&W, single-sided), then enable A3 with a B&W price: A3 appears for customers; colour and double-sided are greyed out.
P3. Place an A3 test order: the total uses the A3 price; Orders, Queue and Job sheet say A3 (297 × 420 mm) and "LOAD A3 PAPER"; the job sheet itself still prints on A4.
P4. Make the Large printer inactive: A3 shows "currently unavailable"; an A3 order already in the queue shows "No active printer can do this job".
P5. Add a custom size "Photo 4x6" (102 × 152): it stays hidden until priced and given a printer. Change A4 prices in Settings and in Paper & printers: both pages agree.
P6. In SQL as an ordinary customer/anon: `update public.paper_prices set price_paise = 1` must fail.

**Print queue (new)**
Q1. Place 3 test orders (one colour, one B&W 2-sided, one delivery if enabled). In Orders confirm them; they appear in `/admin/queue`, oldest first; an unconfirmed order does not, and the "waiting for confirmation" banner counts it.
Q2. Use each filter and sort; check Next up is the job already printing, if any.
Q3. Open a job sheet: compare pages, copies, colour, duplex, instructions, address (delivery only) and payment line with the order. Click **Print job sheet**: the browser print dialog opens; preview shows one clean black-and-white A4 page with no site header/buttons. Check `audit_logs` has `job_sheet.print_opened`.
Q4. View customer PDF from the queue: opens, expires after about a minute; `file.viewed` is logged.
Q5. Walk one order Start preparing → Start printing → Ready for pickup. Mark completed is not offered until you Record cash; record it, then complete. Open the queue in two tabs and click the same step in both: the second is refused.
Q6. In SQL: `update public.orders set status='completed' where status='confirmed'` fails (trigger).
Q7. Print the job sheet on a phone-size window: it should be readable.

**Earlier checks**
1. `/admin` while signed out → redirected to login. Sign in as a user **not** in `admin_users` → refused. Sign in as admin → dashboard loads.
2. Place a customer order (pickup, cash). It appears in Orders as *Pending confirmation / Cash pending*; dashboard counts update.
3. Search by order number, phone and name; try each filter and the date range.
4. Open the order: View and Download the PDF (opens a link that expires after about a minute). Check `audit_logs` has `file.viewed` / `file.downloaded`.
5. Move it confirmed → preparing → printing → ready for pickup (each asks for confirmation). Try to complete before cash: refused.
6. Record cash with a wrong amount (refused), then the right amount (OK), then again (refused). Check `cash_collections` has one row with your email and time; order is *Paid*; then complete it.
7. Cancel a different order without a reason (blocked), then with one. Try cancelling the paid one (refused).
8. Settings: change a rate and save; place a new order and confirm the new price; enable delivery with a fee and confirm customers see it; try invalid values (negative, 26 MB).
9. In another browser, sign in as a normal customer-type Supabase user: `/api/admin/orders` must return 403.
10. In Supabase SQL: `update public.orders set payment_status='paid'` on a cash order must fail.

## PENDING (not implemented)
Paper/printers: assigning an order to a specific printer (the queue only shows which printers *could* do it) · printer-specific queues · per-printer paper stock · orientation and fit-to-page choices for customers · the homepage marketing text (₹9 / ₹2, A4) is static and does not follow catalogue prices · Customer order tracking with OTP and customer notifications (**next phase**; the order reference, statuses and audit trail it needs are in place) · Online payments (Razorpay) and refunds · order tracking with OTP · customer notifications · camera scanner and image uploads · OCR/AI quality checks · admin: internal notes, daily/monthly sales summary, batch-printing combined sheets, paper/orientation editing, user management UI, audit-log viewer · delivery distance enforcement · shared (Redis) rate limiting · malware scanning · 2FA enforcement (use Supabase settings).
