# Paid voting deployment and operations

The frontend contract is implemented at `/votes/api`. Poll, candidate, purchase,
payment accounting, receipt capability and admin authentication services are
separate from the quiz/game modules. Prices and quantities come from saved poll
configuration. Public totals are `null` when results are hidden. All totals come
from the signed, immutable ledger; results remain provisional until outstanding
payments and disputes are resolved.

## Deployment

Use an existing PostgreSQL database containing the quiz application's existing
tables. The migration CLI previously targeted MySQL; it now targets PostgreSQL,
does not initialize on import, does not load dotenv files, and disables SQL
logging. The application also disables automatic schema synchronization.
This migration adds voting tables only; it is not an initial quiz schema migration.

Have the deployment secret manager inject `DATABASE_URL` into the migration
process, then run `npm run migration:run` (`npm.cmd` on PowerShell).
The CLI validates TLS certificates by default; `DATABASE_SSL=false` is for a
local, isolated database only. Supply the appropriate trusted CA for hosted DBs.
Do not run migration generation against production. Financial data rollback is
deliberately refused; recovery requires backups and an audited forward migration.

For existing installations, removing the account-ID requirement needs migration
`FlutterwaveKeyScopedVoting1794787200000`, or run
[`sql/voting-remove-account-id-requirement.sql`](sql/voting-remove-account-id-requirement.sql)
once before deploying this version. This relaxes the old database account-snapshot
requirement without altering purchases or ledger entries. Restart the backend and
recheck the original receipt: old `ACCOUNT_MISMATCH` reviews recover automatically
when the server API confirms matching successful payment evidence.

Configure these server-only settings without putting secrets in a public frontend
environment variable:

| Setting                         | Meaning                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VOTING_PAYMENTS_ENABLED`       | Explicitly `true` to accept new paid purchases; absent/false disables them.                                                                                                             |
| `VOTING_RECONCILIATION_ENABLED` | Set `true` to keep reconciliation running when new purchases are disabled.                                                                                                              |
| `VOTING_FRONTEND_ORIGIN`        | Canonical frontend origin with no path/query/credentials. HTTPS is required in production; HTTP loopback origins such as `http://localhost:3000` are allowed outside production.        |
| `VOTING_ALLOWED_ORIGINS`        | Comma-separated exact frontend origins for voting endpoints, including voting admin login. Development also allows `http://localhost:3000`; production requires explicit configuration. |
| `VOTING_TRUST_PROXY_HOPS`       | Optional positive integer for the actual trusted proxy topology. Incorrect configuration undermines IP rate limits.                                                                     |
| `VOTING_MAX_AMOUNT_MINOR`       | Positive safe integer, at most 100000000 kobo; default 100000000. The poll's price multiplied by its maximum quantity must fit.                                                         |
| `VOTING_CHECKOUT_SECONDS`       | Saved payment window, 60–86400 seconds; default 1800.                                                                                                                                   |
| `VOTING_IMAGE_HOSTS`            | Allowed hosts for legacy candidate `photoUrl` input; not needed for backend Cloudinary uploads. No remote photo fetching occurs.                                                        |
| `FLUTTERWAVE_SECRET_KEY`        | Secret API key for the intended merchant account and mode.                                                                                                                              |
| `FLUTTERWAVE_SECRET_HASH`       | Random secret hash configured in the Flutterwave v3 webhook dashboard; never put it in frontend settings.                                                                               |
| `VOTING_PROVIDER_MODE`          | `test` or `live`; verified transactions must match it.                                                                                                                                  |
| `VOTING_RECEIPT_KEY`            | 32 random bytes encoded as 64 lowercase hex characters, kept stable and backed up.                                                                                                      |
| `VOTING_ADMIN_EMAIL`            | Email of the enabled administrator provisioned below.                                                                                                                                   |
| `VOTING_ADMIN_PASSWORD_HASH`    | `salt:hexDigest`, Node scrypt with a random salt, output length 64 bytes and default scrypt parameters.                                                                                 |
| `VOTING_ADMIN_JWT_SECRET`       | Independent, high-entropy signing secret for voting administrators.                                                                                                                     |
| `BREVO_API_KEY`, `BREVO_SENDER` | Required for delivery of queued, plain-text verified payment receipts.                                                                                                                  |

Provision an administrator using parameterized SQL in a trusted operator tool:

```sql
INSERT INTO voting_admins (id, email, name, enabled, can_manage_votes)
VALUES ($1::uuid, $2, $3, true, true);
```

Generate the UUID and the password hash securely during deployment. No built-in
password is supplied. On Windows, run this helper from the project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\New-VotingAdminPasswordHash.ps1
```

It prompts for a hidden password and prints the complete
`VOTING_ADMIN_PASSWORD_HASH=salt:hexDigest` assignment. Replace the existing
assignment in the backend environment file, restart the backend, and log in
with the password you entered. The helper does not open or edit environment files.
The error `Admin credentials are not configured` means the configured hash has
an empty salt or a digest that is not exactly 128 lowercase hexadecimal characters.

Voting login is `POST /votes/api/admin/login` with `{ "password": "..." }`.
It returns `{ success: true, message: "...", data: { name, email, level, token } }`
and issues a one-hour database-backed voting session with its own JWT
issuer/audience/key. Only this endpoint requires the `VOTING_ADMIN_*` settings.
There is no built-in voting password. Student and legacy portal tokens cannot
authorize voting administration. Revocation and current voting permissions are
checked on every voting admin request.

The existing portal login, `POST /users/api/login-admin`, retains its original
credentials and response behavior. It does not use voting configuration, voting
tables, voting rate limits or the voting origin allowlist. Leaving voting
unconfigured therefore cannot block the existing dashboard login. Other legacy
admin/quiz endpoints retain their existing behavior and have not undergone an
authorization audit as part of this voting change.

Frontend: keep the existing portal login and its session as they are. For voting
management, call `/votes/api/admin/login` and retain the returned session
separately (for example `sessionStorage.votingAdminSession`). Send that token to
`/votes/api/admin/*`; do not overwrite the existing portal session. Voting setup
failures should be displayed within voting management without blocking navigation
to the rest of the admin dashboard. Frontend code is not in this repository.

For a new administrator, you can instead edit and run
[`sql/provision-voting-admin.sql`](sql/provision-voting-admin.sql), replacing its
email placeholder with your configured `VOTING_ADMIN_EMAIL`. It creates the
record or enables the existing record without changing its ID. Creating the
voting tables alone does not create an administrator.

If a correct password still returns `Invalid admin credentials`, check the
backend terminal for the sanitized diagnostic emitted during that attempt:

| Diagnostic                  | Action                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `ADMIN_NOT_PROVISIONED`     | Provision the configured email using the SQL file above.                |
| `ADMIN_DISABLED`            | Re-enable the intended administrator using the SQL file.                |
| `VOTING_PERMISSION_MISSING` | Grant voting management permission to the intended administrator.       |
| `AMBIGUOUS_ADMIN_EMAIL`     | Resolve duplicate email records that differ only by casing/spaces.      |
| `PASSWORD_MISMATCH`         | Regenerate the hash for your intended password and restart the backend. |
| `INVALID_LOGIN_BODY`        | Send a JSON object containing a string `password` field.                |

Public login responses remain generic. Logs contain no submitted passwords,
hashes, email addresses or tokens. Password whitespace remains significant;
only the configured account email is normalized for matching.

Revoke sessions or remove permission using parameterized operator SQL:

```sql
UPDATE voting_admin_sessions SET revoked_at=now() WHERE admin_id=$1::uuid;
UPDATE voting_admins SET can_manage_votes=false WHERE id=$1::uuid;
```

The app applies database-backed limits of 120 reads/minute and 20 mutations/minute
per IP, shared across instances. Voting admin login is limited too. Authenticated webhooks use
the durable event queue rather than these public IP limits; enforce body size,
connection and abuse limits at the reverse proxy. Return request bodies, tokens,
email addresses, payment URLs and authorization headers must be excluded from
proxy/APM logs. Persisted error codes and worker alerts contain no payer data.

## Provider setup and accounting

The provider is Flutterwave Standard **v3**, using `POST /v3/payments`.
Set the webhook URL to `https://<backend>/votes/api/webhooks/flutterwave` and select
V3 webhooks in the Flutterwave dashboard. Configure the secret hash and enable
charge, refund and chargeback notifications. The backend compares the `verif-hash`
header in constant time, then verifies the transaction through the server API.
This is v3 shared-secret authentication; it does not claim to HMAC-sign the body.
Flutterwave v4's `flutterwave-signature` is a different contract and is not accepted
by this v3 endpoint. See [Flutterwave v3 webhooks](https://developer.flutterwave.com/docs/webhooks).

Run all registered migrations, including `VotingImages1794700800000` for images.
The Flutterwave migration tags pre-existing
records as Paystack and defaults new purchases to Flutterwave. It preserves old
financial records and scopes provider transaction uniqueness by provider. Old
Paystack attempts cannot resume through Flutterwave and are excluded from the
Flutterwave worker; reconcile any such real attempts separately before switching.
No data is silently moved between providers.

Payments use server-initiated hosted checkout on `checkout.flutterwave.com`, in the
same browser tab. The server sets the callback URL. Only the opaque purchase ID
appears in it. The receipt capability is 32 random bytes, hashed for checking and
encrypted with AES-256-GCM plus purchase-ID associated data for idempotent replay.
It never appears in provider metadata, public responses or URLs.

Test mode also accepts the exact HTTPS sandbox hostname
`checkout-v2.dev-flutterwave.com`, which is present in Flutterwave's
[official sandbox redirect examples](https://developer.flutterwave.com/docs/zambia-mobile-money).
Live mode accepts only `checkout.flutterwave.com`. HTTP, credentials in URLs,
non-default ports and lookalike/subdomain suffixes remain rejected. Rejection
logs contain only hostname, scheme and mode, never the checkout path/token.

Transaction verification uses the merchant secret's account-scoped API, not
webhook fields. The server calls `/v3/transactions/verify_by_reference?tx_ref=...`.
Authenticated `charge.completed` webhooks additionally verify their transaction
ID through `/v3/transactions/:id/verify` before crediting. The event is persisted
before this API call; verification failures retain it and return a non-2xx result
so Flutterwave can retry. Verified transaction IDs are reused on receipt and
background checks. Webhook IDs/statuses alone never prove payment, and the
reference, amount, currency, mode and ledger checks still apply.
No new migration or frontend parameter is needed for this verification path.
The amount sent to Flutterwave is an exact naira decimal converted from saved kobo;
verified amounts are converted back without floating point multiplication. `successful`
is the only credited payment status. The saved reference, unique transaction ID,
exact amount, NGN currency and key mode must all match. Merchant access is
authorized by the server secret key; `FLUTTERWAVE_ACCOUNT_ID` is no longer required
or compared with payment evidence. Legacy account snapshots are retained as
history; new purchases leave that field null. Mode is saved on the purchase.
Key prefix and configured mode must agree.
Keep the
configured secret on the same merchant account; do not switch merchants or modes
while that deployment has unresolved purchases. Key rotation must preserve account
scope. See [Flutterwave reference verification](https://developer.flutterwave.com/reference/verify-transaction-with-tx_ref).
64-bit provider transaction IDs are preserved as strings.

Flutterwave v3 exposes `created_at` on verified transactions, without a separate
capture/settlement timestamp. This adapter records that timestamp when available;
it does not prove a separate settlement time. Missing, inconsistent or late
provider timestamps do not block a matching, server-verified successful payment.

Receipt checks and webhook reconciliation share one accounting service. Purchase
row locks, transaction-ID advisory locks, unique ledger entries and database
transactions prevent repeat credit. A full verified reversal adds one negative
ledger entry. Stale success cannot undo it. A processed refund is independently
fetched from Flutterwave's paginated refund list and matched to the original transaction, merchant account and full amount;
partial/inconsistent refunds enter review instead of inventing a v1 partial state.
Flutterwave's plain `completed` refund status means initiated/pending disbursement,
so it does not reverse votes. Only documented final `completed-*` outcomes count.
Chargebacks without independently verified full reversal evidence remain in review.
See [Flutterwave refund statuses](https://developer.flutterwave.com/docs/refunds).

A purchase accepted before closing is credited automatically when Flutterwave's
server API confirms success with the matching reference, amount, currency,
mode, even after its checkout window or poll closes. Merchant access is scoped
by the server secret key.
New purchases still enforce the poll's open period. Poll close and acceptance
share a poll row lock. Redirects, browser cancellation, provider errors and a
missing provider record never prove failure or expiry. Uncertain purchases remain
pending. Provider-confirmed abandonment after the saved checkout window can mark
a purchase expired. Failed/expired transactions can be updated by later verified
success. Crediting remains idempotent, and a recorded reversal cannot be undone
by a later success notification.

## Recovery, review and refunds

The worker runs every 30 seconds, leases work across instances, retries pending
verification at five-minute intervals, checks paid/refunded records daily and
delivers queued email receipts with retries. Delivery is at least once, so an
email can repeat after a worker crash. Processed webhook routing records expire
after 90 days; purchases, ledger entries and admin audit records are retained.
Alert on worker failures, pending/review purchases older than one hour, growing
webhook/email queues and repeated initialization errors. The application emits
sanitized worker warnings and unresolved counts; connect these to your alerting
system before launch. Ledger-derived totals need no cached aggregate repair.

An uncertain initialization is intentionally **never initialized again** by an
automatic retry. This prevents a crash or timeout from causing a second charge.
Backend logs now show a safe operation/code, for example
`Flutterwave INITIALIZE_CHECKOUT failed: HTTP_401`, and the purchase ID for a
blocked initialization. Provider bodies, payer data and credentials are not
logged. Failed verification no longer overwrites an existing initialization
diagnostic. Local configuration is validated before the initialization marker is
committed; correcting a local configuration failure can therefore retry safely.
Initialization logs distinguish `PROVIDER_INITIALIZATION`, `SAVE_CHECKOUT_URL`,
and `BUILD_CHECKOUT_RESPONSE`. An HTML/empty error response no longer loses its
HTTP status during JSON parsing. Invalid successful JSON is reported as
`INVALID_PROVIDER_JSON`; rejected hosted domains as `CHECKOUT_URL_REJECTED`;
database failures include a sanitized `DATABASE_SQLSTATE_...` code. A stored
receipt encrypted under another key is `RECEIPT_DECRYPTION_FAILED`; restore the
original receipt encryption key rather than generating a replacement. Existing
receipt capability decryption is checked before issuing a new initialization.
These logs never contain the URL, ciphertext, keys, SQL parameters or provider body.
Flutterwave's verify API does not promise to return the lost hosted checkout URL.
Retries verify the same saved reference and keep the original attempt locked.
An operator must recover the existing hosted URL/access code from the provider
using that reference, validate its HTTPS `checkout.flutterwave.com` host, and restore
only `checkout_url` with parameterized SQL. Do not change the idempotency key,
merchant reference or receipt capability, and do not reset `init_started_at`.
If no checkout exists, obtain definitive provider confirmation before any audited
resolution. There is no claim of automatic URL recovery or automatic recharging.

For sandbox development only: if the operator has confirmed test mode and that
checkout never opened or received a payment, use
[`sql/inspect-voting-checkout.sql`](sql/inspect-voting-checkout.sql) to identify
the exact purchase, then replace `target_id` in
[`sql/retry-unopened-test-checkout.sql`](sql/retry-unopened-test-checkout.sql)
and run it. This guarded exception retains the existing reference, body/key and
receipt capability. It refuses live-mode, expired, recently initializing,
transaction-linked, credited, non-pending or already-linked purchases. Retry the
same saved frontend attempt after the reset. This is not live-payment recovery.

Receipt reads, successful charge webhooks and reconciliation automatically
recover earlier timestamp-related or payment-evidence reviews when fresh API
evidence matches. Manual, dispute, refund and disqualification holds stay in
review. Ordinary receipt confirmation does not require a separate refund-list
lookup; refund notifications and scheduled paid-payment reconciliation retain
that check. No frontend change is needed for this behavior:
restart the backend and recheck the existing receipt without creating a new charge.

For remaining `REVIEW` records, investigate the account-scoped provider transaction,
saved `review_reason`, and ledger. Logs now include purchase ID and the trigger
(`RECEIPT`, `RECONCILIATION`, `WEBHOOK`, or `CHECKOUT_RETRY`), so a failed check
for an old abandoned purchase can be distinguished from the latest payment.
Failed checks are stored as specific codes such as `REFERENCE_MISMATCH`,
`AMOUNT_MISMATCH`, or `CANDIDATE_DISABLED`. Run
[`sql/inspect-voting-checkout.sql`](sql/inspect-voting-checkout.sql) to inspect
the reason without exposing payer information or receipt capabilities. A
`REVIEW` record is not resolved by resetting initialization or changing it to
`PAID`; preserve the record and investigate the stated reason.

For operational resolution, inspect the provider evidence, timestamps,
saved amount/quantity and ledger before resolving. Never edit snapshots, ledger
rows or credited counts. For unresolved mismatches, disqualifications and
disputes, the v1 operational resolution is a full provider refund to the original
payment instrument. A successful provider reversal/full processed refund is
verified and applied by reconciliation. Do not mark `REFUNDED` manually, and do
not resolve review by setting `PAID`. No admin credit/refund UI or endpoint is
exposed. Keep audited incident notes outside public logs. Partial refunds require
a contract extension and are not automatically reversed.

When a guest loses the original browser session, support must verify ownership
out of band through the receipt email and the provider's authenticated customer
support process. Never disclose email addresses, mint a replacement capability,
or accept knowledge of a purchase ID as proof. Support may confirm the outcome
privately or arrange an original-instrument refund after ownership verification.
Self-service capability recovery requires the future verified-email flow.

## Verification and launch gate

Run `npm run test:voting` and `npm run build`. Voting tests use PGlite, an isolated
PostgreSQL WASM engine, without reading dotenv files or calling payment/email
providers. Node's VM modules flag is included in the test scripts because PGlite
uses dynamic imports inside Jest. These tests exercise SQL migrations/triggers,
hidden results, duplicate requests and credits, receipt privacy, admin revocation,
late/mismatched evidence, full reversals, worker SQL and HTTP module wiring.
They do not prove multi-connection production locking or provider interoperability.
The voting suite includes upload, image ownership and multipart HTTP checks alongside payment/auth checks. The wider repository test run
has 10 existing suites that cannot resolve `src/...` imports under Jest; those
unrelated suites have not been modified.

Before enabling real payments, apply the migration, provision the admin, verify
CORS and proxy limits, configure alerting and support ownership/refund procedures,
and execute the frontend handoff's acceptance checklist in the provider sandbox.
Specifically test actual v3 `verif-hash` authentication, full-refund payloads,
initialization response loss and operator URL recovery, concurrent database
connections, close-versus-purchase races, scheduled opening/natural close, email
delivery and provider mode/account mismatches. Then perform a controlled production
payment/refund with ledger reconciliation. Leave payments disabled until these
checks pass. No live database migration, sandbox payment, production charge,
refund, email delivery or browser checkout was performed during implementation.

## Cloudinary voting images

Poll covers and candidate portraits now support backend Cloudinary uploads.
Apply [`sql/voting-cloudinary-images.sql`](sql/voting-cloudinary-images.sql) to
an existing voting database, then configure `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` on the backend and restart it.
The combined migration SQL also includes this upgrade. Never put the secret in
frontend environment variables.

Use `POST /votes/api/admin/images` with a voting admin bearer token and multipart
fields `file` and `purpose` (`POLL` or `CANDIDATE`). Submit the returned image ID
as `imageId` when creating a poll or `photoImageId` when registering a candidate.
Existing image-free creation remains valid. Poll responses include nullable
`imageId`/`imageUrl`; candidates return `photoImageId` and their existing `photoUrl`.
The complete frontend contract and sample upload helper are in
[`voting-images-frontend.md`](voting-images-frontend.md).
