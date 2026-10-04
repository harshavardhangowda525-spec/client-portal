# Infinity Web & Apps — Client Project Portal

A private client portal and admin dashboard for Infinity Web & Apps. Clients review and accept quotations, follow milestones, review website previews, see invoices and payments, exchange messages and download documents. You manage everything from `/admin`.

**Stack:** Next.js 15 (App Router, server actions) · PostgreSQL with forced Row Level Security · `postgres` driver · Zod validation · pdf-lib PDFs · optional SMTP / WhatsApp Cloud API / Razorpay.

## How it fits together

| Area | Where |
| --- | --- |
| Database schema, RLS policies, immutability triggers | `db/migrations/001_init.sql` |
| Business logic + authorization (every function takes the authenticated actor) | `src/server/*.ts` |
| Server actions (thin wrappers) | `src/app/actions/*.ts` |
| Client portal | `src/app/portal/[projectId]/…` |
| Admin dashboard | `src/app/admin/…` |
| Authenticated file / PDF / Razorpay endpoints | `src/app/api/…` |

### Security model
- **Authorization runs in two layers.** Service functions check the actor's role and project access. Every query also runs in a transaction that sets `app.role` / `app.user_id`, so Postgres RLS policies, forced even for the table owner, enforce the same rules. A client can only read rows for projects they are a member of. Drafts, internal updates, internal documents, internal notes, unconfirmed payments and admin quotation notes are never visible to clients.
- **Sessions:** a random 256-bit token is kept in an `httpOnly`, `SameSite=Lax` cookie and stored only as a SHA-256 hash. Sessions expire after 14 days and can be revoked. Revoking a client's portal access ends their sessions immediately.
- **Logins** are rate-limited per email and per IP. Passwords are hashed with scrypt.
- **Invitations** use single-use, expiring (7-day) random tokens, stored only as hashes. Resending issues a new link and invalidates the old one.
- **Quotations:**
  - Accepting requires explicit confirmation of the scope and terms plus a typed signature.
  - The record captures the user, timestamp, IP, version number, a SHA-256 fingerprint of the exact content and a full snapshot of the terms.
  - Database triggers make accepted versions and acceptance records immutable. Changes always create a new version.
- **Payments** are never marked as received automatically. Manual payments are recorded by an admin, as pending or confirmed. Online (Razorpay) payments are recorded only after the server verifies the signature and checks with Razorpay that the payment was captured for the right order and amount. The database enforces this with a CHECK constraint.
- **Files** are stored privately in Postgres (max 15 MB each) and served only through authenticated routes with `nosniff`. Downloads are sandboxed, except PDFs, which the browser viewer needs.
- **Audit log:** append-only, covering quotation, financial, access and project events.

## Proposal builder

Go to **Admin → Proposals** to create proposals for websites and mobile apps, and **Settings → Pricing configuration** to set prices and terms.

- **Pricing configuration** is stored in the database, so nothing is hardcoded. It covers:
  - business details and logo
  - GST/tax
  - proposal defaults (validity, warranty, terms)
  - packages, whose breakdown must add up to the package price (defaults: ₹4,999 website, ₹55,000 app)
  - optional services with price ranges, where you always enter the actual quoted price
  - external costs, which stay "To be confirmed" until you enter a real quote
  - maintenance plans, discount rules (percentage or fixed, optional maximum) and payment milestone templates
- **8-step wizard**:
  1. Client and project
  2. Website pricing
  3. App pricing (with platform and scope fields, and warnings when the request exceeds the package)
  4. External costs: one-time or recurring, provider cost kept internal, who pays
  5. Maintenance and warranty
  6. Scope and timeline
  7. Discount, tax and payment milestones
  8. Review
- **Calculation:** a live panel shows the totals as you go. The server recalculates everything on every save using database prices and settings, and ignores any total sent from the browser.
  - Package breakdown items are shown as inclusions and never charged twice.
  - Recurring fees never enter the one-time total.
  - Milestones must add up exactly to the total before sending.
- **Versions:** once sent, a version is locked by database triggers. Changes need a revised version, which the client must approve again. Accepted versions and acceptance records can never be changed.
- **Client portal → Proposals:** clients can view proposals, download the PDF, ask questions, request changes, accept or decline.
  - Before accepting, the client sees a summary of the one-time total, payment schedule and recurring costs.
  - Acceptance records the user, time, IP, version, a content fingerprint and a copy of the terms. It is labelled as an electronic acceptance, not a certified digital signature.
- **After acceptance:** create or link a project. The accepted proposal then becomes the project's billing baseline, so you can raise invoices from its payment schedule. Nothing is marked paid automatically.
- **Sharing:**
  - publish to the portal, optionally with email; email is shown as "sent" only when the provider accepts it
  - secure link (sign-in required)
  - WhatsApp message with a copy button
  - a portal invitation, if the client has no account yet

### Upgrading an existing deployment (Neon SQL Editor)
If you set up the database by pasting `001_init.sql` into the Neon SQL Editor, do the same for each new migration. Then grant the app user access to the new tables:
1. Open `db/migrations/002_proposals.sql` on GitHub, click **Raw**, copy everything, paste it into the SQL Editor and **Run**.
2. Run:
```sql
insert into schema_migrations (name) values ('002_proposals.sql');
grant select, insert, update, delete on all tables in schema public to portal_app;
grant usage, select on all sequences in schema public to portal_app;
```
Running `npm run db:migrate` as the database owner does the first step automatically. You still need the grants if the app connects as `portal_app`.

## Local development

```bash
cp .env.example .env            # set DATABASE_URL (non-superuser role!) and APP_URL
npm install
npm run db:migrate              # creates the schema
npm run admin:create            # interactive: creates the first admin (no hardcoded credentials)
npm run dev                     # http://localhost:3000
```

Optional, clearly labelled sample data: `npm run sample:seed`. Remove it with `npm run sample:remove`. Sample rows are flagged `is_sample`, named `[SAMPLE] …`, and use `@example.test` emails.

### Tests
```bash
npm test                        # 75 integration/unit tests against a real Postgres (TEST_DATABASE_URL, default …/portal_test; the DB is reset)
npm run test:e2e                # full browser workflow against a running app (needs an admin: E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD)
```
The tests cover:
- the full workflow: client → quotation → revision → acceptance → commencement → milestones → preview feedback → invoice → payment → handover
- isolation between clients, at both the service and raw-SQL (RLS) level
- invitation abuse cases
- lockout after repeated failed logins
- immutability of accepted quotations and the audit log
- rules that stop payments being marked paid without confirmation
- sample-data removal

## Workflow

1. **Admin → Clients → New client.** Then create the project. The standard 14-step website milestone plan with weights is optional, and you can edit, reorder or delete milestones.
2. **Quotations tab:** create a draft from a template, then edit line items, discount, tax, payment milestones, inclusions, exclusions and terms. Download a PDF preview.
3. **Client page → Create invitation link.** If email is configured it is sent; otherwise copy the link, or use **Open in WhatsApp** for a pre-filled chat.
4. **Send the quotation.** The client signs in, reviews it, and accepts, requests changes or declines. Requested changes lead to **Create revised version**.
5. When a quotation is accepted you are notified, and the project overview shows **Confirm commencement & payment terms**, with a reminder to invite the client if they haven't joined yet.
6. Day-to-day work:
   - update milestones (progress is the weighted share of completed milestones)
   - publish preview URLs
   - post updates, including internal-only ones
   - request approvals or feedback
   - answer messages
7. **Invoices & payments:** create invoices from the accepted payment milestones, issue them, and record payments as pending or confirmed. Overdue invoices are flagged and never marked paid.
8. Complete the final milestones and set the project to **Completed**. Projects can also be put on hold, set to waiting for client, cancelled or declined.

## Deployment checklist

Before using the portal with a real client:

**Required**
- [ ] **PostgreSQL 14+** (for example Neon, Supabase Postgres, Railway, RDS). Create a dedicated role that is **not** a superuser and does **not** have `BYPASSRLS`, give it ownership of the database, and set `DATABASE_URL`. After deploying, **Admin → Settings → Security** must show "Row Level Security: Enforced".
  - On Supabase, don't use the default `postgres` role. Create your own login role.
  - Behind a transaction pooler (PgBouncer or a Supabase pooler on port 6543), prepared statements are disabled automatically when the URL contains `pooler` or `pgbouncer`.
- [ ] Run `npm run db:migrate` against the production database.
- [ ] **Node.js 20+ host** for Next.js (Vercel, Railway, Render, Fly.io or a VPS). Files are stored in Postgres, so stateless or serverless hosts work.
- [ ] Set `APP_URL` to the public HTTPS URL (it is used in invitation links) and `COOKIE_SECURE=true`.
- [ ] Create your admin account with `npm run admin:create`, using a strong unique password. If the host has no shell, set a long random `ADMIN_SETUP_TOKEN` once, visit `/setup`, then **remove the variable**. The page disables itself as soon as an admin exists.
- [ ] Set the company details printed on PDFs: `COMPANY_NAME`, `COMPANY_EMAIL`, `COMPANY_PHONE`, `COMPANY_ADDRESS`, `COMPANY_TAX_ID` (GSTIN, if registered).
- [ ] Review the default quotation template (**Admin → Quotation templates**). Prices, terms and tax rate are placeholders, and tax defaults to 0%.
- [ ] Don't seed sample data in production, or run `npm run sample:remove` if you did. Settings shows how many sample clients exist.
- [ ] Set up daily database backups with your provider.

**Optional integrations.** Each one shows its setup status in Settings. When a provider isn't configured, nothing is reported as delivered.
- [ ] **Email (SMTP):** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Any SMTP provider works (Google Workspace, Zoho, Brevo, Postmark, SES…). Set up SPF and DKIM for the sending domain.
- [ ] **WhatsApp Cloud API:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`. You need a Meta Business account and an approved template with one body variable. Without it, use the manual **Open in WhatsApp** button.
- [ ] **Razorpay:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`. Test with test-mode keys first. For the webhook, set `RAZORPAY_WEBHOOK_SECRET` and point a Razorpay webhook (events `payment.captured`, `order.paid`) at `https://<your-domain>/api/razorpay/webhook`.

**Keep secret.** Never commit these values or expose them to the browser: `DATABASE_URL`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SMTP_PASSWORD`, `WHATSAPP_TOKEN`, `ADMIN_SETUP_TOKEN`. All of them are read only on the server.
