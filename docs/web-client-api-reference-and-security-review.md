# 05 - Wallet-API authoritative reference and browser-client gap analysis

| | |
|---|---|
| Subject | `C:\Users\Imran\StudioProjects\Wallet-API` ("webuddy-wallet-api", NestJS 8 / TypeORM 0.2 / MySQL) |
| Source state | git HEAD `8903609c` (2026-08-19) on top of a working tree with only `error_log.txt` modified and `.npmrc`, `inspect74.js` untracked |
| Method | Read-only. Every file under `src/`, `database/`, plus `api_endpoints.md`, `CPANEL_DEPLOY.md`, `.env.example`, `docker-compose.yml`, `create_bank_details_table.sql`, `migrate.js`, `package.json`, bootstrap/entry scripts, the Android HTTP clients, the `clarivahub` PHP wallet proxy and the stock Synapse source (rate-limit defaults) were read. `api_endpoints.md` is **stale** (see Appendix B) - this document is derived from code. |
| Executed checks | Four throw-away scripts in the session scratchpad (never inside a repo) confirmed: how TypeORM 0.2.45 renders `where: {x: undefined}`; how Express answers a CORS pre-flight; what the real DTOs + `ValidationPipe` accept/reject; that inline-typed `@Body()` parameters skip validation. Results are quoted inline and listed in Appendix D. |
| Secrets | None are reproduced. `.env` was inspected for variable **names** and set/unset only. Two tracked files contain hard-coded DB credentials (see 6.7, finding E17) - values deliberately not copied here. |
| Evidence tags | **[code]** read from source - **[exec]** confirmed by running code - **[infer]** deduced, not directly observable - **[unverified]** depends on production data/config not available to this analysis |

---

## 0. Executive summary

1. **The API has 43 routes; 27 are used by Android.** Only `matrix-session` and `me` verify a JWT. Every wallet, hold, refund, user, call-type, session, payout and expert route is **unauthenticated and keyed by caller-supplied IDs** (Matrix IDs are public). Android sends no `Authorization` header on any wallet route (verified in `WalletApi.kt` / `NetworkModule.kt`).
2. **No CORS anywhere** (`enableCors` is never called; no helmet; no global prefix). A browser at any other origin cannot call the API at all - the pre-flight is answered by Express with `200 Allow: POST` and **no** `Access-Control-Allow-*` headers **[exec]**. This is the single hard blocker for a web client.
3. **`users.current_hold` is the wallet balance** (the name is historical); `users.max_credits` is the **consultant's per-24h-chat price**. Money is INR rupees, `DECIMAL(10,2)`, returned to clients as **strings** from most reads.
4. **A chat is paid by an escrow "hold"**: the first message of a 24h window moves `consultant.max_credits` from the client's balance into a `pending_holds` row; an hourly cron credits the consultant once the hold is >= 24h old, unless a refund was requested (consultant approves/rejects; unattended requests auto-approve 24h after the request).
5. **Matrix accounts are created server-side** by Synapse shared-secret registration; the Matrix password is random, never stored, rotated on every session issue. `POST /v1/auth/matrix-session` creates a **brand-new Matrix device + access token on every call** (no invalidation of older ones) and returns a deterministic server-derived `recoveryPassphrase` for secret storage.
6. **Critical exploitable holes exist today, independent of the web** (findings E1-E18 in section 6.7): anonymous callers can mint wallet balance (`/v1/sessions/*`, `/v1/pending-holds/create`, negative `max_credits` via `PATCH /v1/users`), double-credit settlements (concurrent cron triggers), drain any client's balance into an attacker-controlled consultant (`/v1/pending-holds/initiate`), self-approve refunds, hijack wallet identities (`PATCH /v1/users` renames `Webuddy_name`), and read other users' email, balance, ledger and bank details. A public web app makes these far more discoverable. Most of the money-minting ones are on routes Android never calls and can be closed **without any contract change** (section 7, items S1-S4).
7. **Razorpay web checkout is compatible as-is** (order in paise, INR, standard `order_id|payment_id` HMAC-SHA256 signature, webhook for `payment.captured` / `payment.failed`) - and is already implemented once: the `clarivahub` marketing site (`C:\Users\Imran\StudioProjects\clarivahub`, `recharge.html` + `api/*.php`) runs Razorpay Web Checkout against `recharge` / `verify` through a **same-origin PHP proxy** (it exists precisely because the API has no CORS). That proxy is a **third API client** that any hardening must keep working (section 7, S5). Google web sign-in works unchanged if the web uses the same Web OAuth client ID (or its ID is appended to `GOOGLE_CLIENT_IDS`).
8. **Stripe is not implemented** (enum value in an unused DTO only). `sessions`, `payouts` and `experts` are legacy/mock modules not wired into the hold-based money flow; Android's bank-details save very likely returns 404 (it sends a Matrix ID as `expertId`; no route creates `experts` rows).
9. **Scaling trap on the Matrix side**: every `matrix-session` is a password login from the Wallet-API host's single IP, and stock Synapse limits that to a burst of 5 then ~1 per 5.5 minutes (`rc_login`) unless the production homeserver overrides it (unverified). Each call also adds a device that is never removed.
10. **Money races**: concurrent settlement runs double-pay consultants (also reachable through the unauthenticated cron trigger), and two quick first sends can create two holds (InnoDB snapshot read); refund request / approve have smaller races (6.8).

---

## 1. Architecture and deployment

### 1.1 Stack **[code]**

| Item | Value |
|---|---|
| Framework | NestJS `8.4.7` (`@nestjs/common/core/platform-express`), Express `4.18.1` |
| ORM / DB | TypeORM `0.2.45`, `mysql2 2.3.3`, MySQL (remote, shared; `synchronize: false`) |
| Auth libs | `@nestjs/jwt 8.0.1` (HS256), `google-auth-library 10.9.0`, Node `crypto` (scrypt, HMAC) |
| Payments | `razorpay 2.9.6` (used); `stripe 14.25.0`, `ioredis`, `sqlite3` are installed but **never imported** |
| Throttling | `@nestjs/throttler 2.0.1` - in-memory, per process, applied **only** to `AuthController` |
| Scheduling | `@nestjs/schedule 1.1.0` / `cron 1.8.2` - jobs run in the Node process's local timezone |
| Mail | `nodemailer 9.0.5` (SMTP, env-configured) |
| TS config | `target: es5`, `emitDecoratorMetadata`, `strictNullChecks: false` (down-levelled classes - see the comment in `matrix.service.ts` about `extends` of Nest exceptions) |
| Node runtime | >= 18 in practice (CPANEL_DEPLOY.md says 18.x or 20.x; an old Node crashes on `??=` in Nest - seen in `app.log`) |
| Tests | `auth.service.spec.ts` / `matrix.service.spec.ts` exist; the AuthService spec's `build()` does not provide the `PasswordReset` repository, `MailService` or `ConfigService`, so it **cannot compile its DI graph** (stale) |

### 1.2 Module map **[code]**

`AppModule` imports: `ConfigModule` (global, `.env` in cwd), `ScheduleModule`, `ThrottlerModule.forRoot({ttl: 60, limit: 60})`, `TypeOrmModule.forRootAsync` (entities: User, Expert, BankDetail, Session, Transaction, PendingHold, RefundRequest, PasswordReset, CallIntent; `logging: ['error','warn']`; `keepConnectionAlive`; keep-alive socket options), then feature modules. Provider: `DbIndexesService`.

| Module | Controller (prefix) | Notes |
|---|---|---|
| `AuthModule` | `AuthController` (`v1/auth`) | `AuthService`, `GoogleTokenVerifier`, `MailService`, `JwtAuthGuard`, `JwtModule` (refuses to boot without `JWT_SECRET`) |
| `MatrixModule` | - | `MatrixService` (Synapse admin + client API over raw `http(s)`) |
| `UsersModule` | `UsersController` (`v1/users`) | |
| `WalletModule` | `WalletController` (`v1/wallet`), `CronController` (`v1/wallet/cron`) | `WalletService` (Razorpay), `PendingHoldsCronService` (hourly cron); imports `PayoutsModule`, `RefundsModule` |
| `PendingHoldsModule` | `PendingHoldsController` (`v1/pending-holds`) | imports `RefundsModule` |
| `RefundsModule` | `RefundsController` (`v1/refund`) | exports `RefundsService` (also used by the cron) |
| `CallsModule` | `CallsController` (`v1/calls`) | |
| `SessionsModule` | `SessionsController` (`v1/sessions`) | legacy |
| `PayoutsModule` | `PayoutsController` (`v1/payouts`) | legacy/mock; also owns the monthly cron |
| `ExpertsModule` | `ExpertsController` (`v1/experts`) | legacy |

`InternalTokenGuard` (`src/common/guards/internal-token.guard.ts`, `X-Internal-Token` vs `INTERNAL_API_TOKEN`, fails closed) **is not used by any controller** (dead code). `RechargeWalletDto` (with the `STRIPE` enum) is also unused.

### 1.3 Boot-time behaviour **[code]**

- `NestFactory.create(AppModule, {rawBody: true})` - raw request bytes are kept for the Razorpay webhook HMAC.
- `trust proxy = 1` (one proxy hop) so `req.ip`, and therefore throttling, uses the real client IP from `X-Forwarded-For`.
- Global `AllExceptionsFilter` and global `ValidationPipe({whitelist: true, forbidNonWhitelisted: true, transform: true})`.
- Port: `process.env.PORT || 3000`. No health route, no CORS, no body-size override (Express default 100 kB), no compression, no helmet (`X-Powered-By: Express` is sent).
- **DDL on boot** (because `synchronize: false` and the schema is "hand-restored"): `AuthService` creates `password_resets`; `CallsService` creates `call_intents`; `RefundsService` adds `refund_requests.notification_sent` (and back-fills old rows to `1`); `DbIndexesService` adds five indexes (section 3). The DB user therefore needs DDL rights; the local `.env` connects to the same remote DB host/name that `migrate.js` hard-codes, **as the `root` user** (checked without printing the value) - so developer runs touch the shared database with full privileges.
- 500s are appended, with stack trace, to `error_log.txt` in the process cwd (unbounded file; it is also tracked in git).

### 1.4 Scheduled jobs **[code]**

| Job | Schedule | Env override | What it does |
|---|---|---|---|
| `PendingHoldsCronService.handleCron` | `0 0-23/1 * * *` = minute 0 of every hour, server-local time | `CRON_EXPRESSION` | Settles / auto-refunds holds older than `HOLD_SETTLE_WINDOW_MS` (24h) - section 4.4 |
| `PayoutsService.handleMonthlyPayoutCron` | `0 0 1 * *` = 00:00 on the 1st, server-local time | none | For every `experts` row with `currentWalletBalance >= 1000` (hard-coded) zeroes the balance and writes a `PAYOUT` row in `transactions`. **Mock - no gateway call.** |

Important details: (a) `CRON_EXPRESSION`, `HOLD_SETTLE_WINDOW_MS`, `REFUND_RESPONSE_WINDOW_MS` are read from `process.env` **at import time**, i.e. before `ConfigModule.forRoot()` has loaded `.env`; they only take effect as *real* OS/PM2/cPanel environment variables, not as lines in `.env` **[infer, from import order]**. (b) The two 24h windows used by `initiateHold()` / `exists()` (hold re-use) are **hard-coded** and not affected by these overrides. (c) There is no leader election: with more than one Node process every process runs the cron (see race R1, section 6.8). (d) The same two jobs can be triggered by anyone via `POST /v1/wallet/cron/*` (unauthenticated).

### 1.5 Outbound dependencies **[code]**

| Target | Used for | Notes |
|---|---|---|
| Synapse `MATRIX_HOMESERVER_URL` (prod: `https://matrix.clarivahub.com`, server_name `clarivahub.com`) | `GET`+`POST /_synapse/admin/v1/register` (nonce + HMAC-SHA1), `POST /_matrix/client/v3/login`, `PUT /_matrix/client/v3/profile/{id}/displayname`, `PUT /_synapse/admin/v2/users/{id}` (password rotation), `POST /_synapse/admin/v1/deactivate/{id}` | 15 s timeout, no retry; admin calls need `MATRIX_ADMIN_TOKEN` |
| Razorpay API | `orders.create` | key id/secret from env |
| Google JWKS (via `google-auth-library`) | ID-token signature check | outbound HTTPS to Google must be allowed |
| SMTP | password-reset code mail | optional |

### 1.6 Environment variables (names only) **[code]** + local `.env` status

| Name | Read in | Purpose | In `.env.example` | Local `.env` |
|---|---|---|---|---|
| `PORT` | `main.ts` | listen port (default 3000) | yes | set |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | `app.module.ts` | MySQL connection | yes | set (host = the remote host documented in CPANEL_DEPLOY.md; db = the `webuddy_mvp` name hard-coded in `migrate.js`) |
| `RAZORPAY_KEY_ID` | `wallet.service.ts` | returned to clients as `keyId`, used for API | yes | set (**`rzp_test_` prefix = TEST mode** locally) |
| `RAZORPAY_KEY_SECRET` | `wallet.service.ts` | Razorpay API + payment-signature HMAC | yes | set |
| `RAZORPAY_WEBHOOK_SECRET` | `wallet.service.ts` | webhook HMAC; if empty the webhook answers 403 | yes | set |
| `MATRIX_HOMESERVER_URL` `MATRIX_SERVER_NAME` `MATRIX_REGISTRATION_SHARED_SECRET` | `matrix.service.ts` | Matrix provisioning is **enabled only if all three are set** | yes | set |
| `MATRIX_ADMIN_TOKEN` | `matrix.service.ts` | required for session re-issue (password rotation) and deactivation | yes | set |
| `MATRIX_RECOVERY_SECRET` | `matrix.service.ts` | optional dedicated secret for the 4S passphrase; falls back to the registration secret | **no** | **not set** (so the passphrase is derived from `MATRIX_REGISTRATION_SHARED_SECRET`) |
| `INTERNAL_API_TOKEN` | `internal-token.guard.ts` | for the (currently unused) `InternalTokenGuard` | yes | set |
| `JWT_SECRET` | `auth.module.ts` (+ fallback pepper) | signs Clariva JWTs; **app will not boot without it** | yes | set |
| `JWT_EXPIRES_IN` | `auth.module.ts` | JWT lifetime (default `30d`) | yes | set (`30d`) |
| `GOOGLE_CLIENT_IDS` | `google-token-verifier.ts` | comma-separated accepted `aud` values; empty disables Google (500 "not configured") | yes | set, **1 id = the Android `GOOGLE_SERVER_CLIENT_ID`** |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | `mail.service.ts` | password-reset email; disabled (warn only) if host/user/pass missing | **no** | **not set** |
| `PASSWORD_RESET_SECRET` | `auth.service.ts` | optional HMAC pepper for reset codes; fallback chain `JWT_SECRET` -> `MATRIX_REGISTRATION_SHARED_SECRET` | **no** | not set |
| `CRON_EXPRESSION` `HOLD_SETTLE_WINDOW_MS` `REFUND_RESPONSE_WINDOW_MS` | `pending-holds-cron.service.ts` | **testing overrides** (cron cadence, 24h settle window, 24h refund-response window). Dangerous in prod | **no** | not set |

### 1.7 Deployment target and reverse-proxy notes

- **Production base URL: `https://wallet.dranzo.com/`** (Android `ClarivaConfig.PRODUCTION_API_BASE_URL`; also in `api_endpoints.md`). Local emulator uses `http://10.0.2.2:3000/`.
- Target is a **cPanel host**: `CPANEL_DEPLOY.md` documents "Setup Node.js App" (Passenger) with startup file `dist/main.js`, `npm install && npm run build`. Code comments additionally refer to "the cPanel/Apache reverse proxy" (`main.ts`) and "the PM2 log" (`app.module.ts`), so the real process manager (Passenger vs PM2) is **[unverified]**. `server.js` (requires `./dist/src/app.module.js`) is a stale alternative entry and would not start; `start.js` and `bootstrap.js` both load `./dist/main`.
- The remote MySQL host is reachable over the public internet (documented in CPANEL_DEPLOY.md); `error_log.txt` shows many `connect ETIMEDOUT` / `ECONNRESET` / `ECONNREFUSED 127.0.0.1:3307` (SSH-tunnel) errors from developer machines - the pool is sensitive to idle drops (hence the keep-alive options).
- Proxy requirements: forward `X-Forwarded-For` (rate limiting depends on it), pass the `Authorization` header (it already works in production for `matrix-session`), do not alter the webhook body. One hop is trusted; any additional proxy/CDN between the browser and Apache changes the correct hop count (6.4).
- There is **no `GET /health`**; uptime checks have to use a real route.
- **Known API consumers**: (1) the Android app (27 routes); (2) Razorpay's servers (`POST /v1/wallet/webhook`); (3) the **`clarivahub` site's PHP proxy** (`api/verify-user.php` -> `GET /v1/users/{mxid}` to read `isConsultant`; `api/create-order.php` -> `GET /v1/users/{mxid}` then `POST /v1/wallet/recharge`; `api/verify-payment.php` -> `POST /v1/wallet/verify`), a no-login "top up any normal member's wallet by username" page. It calls from the hub server's IP, sends **no credential** (its optional `X-Internal-Token` hook, `WALLET_API_TOKEN`, is empty), and treats both `200` and `201` as success. Any future auth must leave these three routes usable by it (S5).
- DB pool: mysql2 default (`connectionLimit` 10) against a remote DB. Android's own source notes that polling at 5 s "was starving the MySQL pool" and was relaxed to 15 s (hold status) and 60 s (balance / hold-exists / rate). A web client must not poll faster.

---

## 2. Endpoint catalogue

### 2.0 Conventions **[code][exec]**

- **Status codes**: Nest defaults. Every `@Post` returns **201** unless `@HttpCode(200)` is present (login, forgot/reset, google, deactivate, matrix-session, cron triggers = 200). Verify / refund / hold / session / payout / webhook POSTs therefore also return **201**.
- **Error envelope** (global filter): `{ "statusCode": <int>, "timestamp": "<ISO>", "path": "<request.url incl. query>", "message": <string | string[]> }`. `message` is an **array** for DTO-validation failures, a string otherwise. Nest's `error` field ("Bad Request") is dropped. Any non-`HttpException` (e.g. a TypeORM `QueryFailedError`, `ER_DUP_ENTRY`, SQL syntax error) becomes `500 "Internal server error"` and is appended to `error_log.txt`.
- **Validation** (`ValidationPipe`, `whitelist` + `forbidNonWhitelisted` + `transform`): unknown properties => `400 ["property X should not exist"]` **only for DTO-class bodies**. Bodies typed with an inline object literal (`refund/*`, `calls/type`, `wallet/webhook`) compile to `Object` and are **not validated at all [exec]** (extra/wrong-typed fields pass). `@Query()` primitives are not validated; a `number`-typed query is coerced with `+value` (`page=abc` => `NaN`). Nest's default parsers accept `application/json` and `application/x-www-form-urlencoded`; any other content type leaves `req.body` empty (so web clients must send `Content-Type: application/json`).
- **Throttling**: only `AuthController` has `@UseGuards(ThrottlerGuard)`. Key = `md5(ClassName-handlerName-req.ip)`, sliding window, in-memory per process, requests rejected with `429 "ThrottlerException: Too Many Requests"` plus `Retry-After` and `X-RateLimit-Limit/Remaining/Reset` headers (not CORS-exposed unless configured). Rejected requests are not counted. No other controller is throttled.
- **Identifiers**: wallet routes identify a user by `Webuddy_name` (= the Matrix ID for every Clariva account, e.g. `@alice:clarivahub.com`; URL-encode it in paths). `wallet/*` additionally accepts the user's UUID `id`. **`matrixUserId` itself is not accepted** by wallet/user lookups - it only works because `Webuddy_name` was set equal to it at provisioning (legacy rows may differ - see 6.8, B3).
- **Numerics**: see the table in 2.9 (DECIMAL columns come back as strings).
- **TypeORM 0.2.45 `where: {col: undefined}` renders `col = NULL`** (matches nothing) **[exec]**, so a missing identifier yields 404/empty, not "first row". (`NaN` also renders `= NULL`: `GET /v1/pending-holds/abc` => 404.)

### 2.1 Route summary (43 routes)

Legend: **Auth**: `-` none, `JWT` = `JwtAuthGuard`. **Thr** = throttle (requests / seconds / per IP), `def` = module default 60/60 s, `-` = not throttled. **A** = used by the Android app (routes #13, #15, #16 are additionally used by the `clarivahub` PHP proxy, see 1.7).

| # | Method + path | Auth | Thr | A | Purpose |
|---|---|---|---|---|---|
| 1 | `POST /v1/auth/register` | - | 10/900 | Y | email sign-up + Matrix account |
| 2 | `POST /v1/auth/login` | - | 10/900 | Y | email-or-username + password -> JWT |
| 3 | `GET /v1/auth/username-available` | - | def | Y | live handle check |
| 4 | `GET /v1/auth/email-available` | - | 30/900 | Y | live email check |
| 5 | `POST /v1/auth/forgot-password` | - | 5/900 | Y | email a 6-digit code |
| 6 | `POST /v1/auth/reset-password` | - | 10/900 | Y | code + new password |
| 7 | `POST /v1/auth/google` | - | 20/900 | Y | Google ID-token sign-in / sign-up |
| 8 | `GET /v1/auth/reauth-method` | - | 20/900 | Y | password vs Google re-auth for deactivation |
| 9 | `POST /v1/auth/deactivate` | - (proof in body) | 5/900 | Y | irreversible account deletion |
| 10 | `POST /v1/auth/matrix-session` | JWT | def | Y | mint a Matrix device/token |
| 11 | `GET /v1/auth/me` | JWT | def | **N** | `{id,email}` from token claims |
| 12 | `POST /v1/users` | - | - | Y | create / fetch-or-create wallet user |
| 13 | `GET /v1/users/:Webuddy_name` | - | - | Y | profile + balance + rate |
| 14 | `PATCH /v1/users/:Webuddy_name` | - | - | Y | change rate / role (and more) |
| 15 | `POST /v1/wallet/recharge` | - | - | Y | create Razorpay order |
| 16 | `POST /v1/wallet/verify` | - | - | Y | verify payment signature, credit wallet |
| 17 | `POST /v1/wallet/webhook` | HMAC header | - | N (Razorpay server) | Razorpay events |
| 18 | `GET /v1/wallet/history` | - | - | Y | ledger page |
| 19 | `GET /v1/wallet/cron` | - | - | N | list jobs |
| 20 | `POST /v1/wallet/cron/pending-holds/trigger` | - | - | N | run settlement cron now |
| 21 | `POST /v1/wallet/cron/monthly-payouts/trigger` | - | - | N | run monthly payout cron now |
| 22 | `GET /v1/pending-holds/exists` | - | - | Y | is the chat paid-for right now |
| 23 | `GET /v1/pending-holds/status` | - | - | Y | bidirectional hold + refund state (polled 15 s) |
| 24 | `POST /v1/pending-holds/initiate` | - | - | Y | create / re-use the 24h hold |
| 25 | `POST /v1/pending-holds/create` | - | - | N | raw hold insert |
| 26 | `GET /v1/pending-holds/all` | - | - | N | dump all holds |
| 27 | `GET /v1/pending-holds/:id` | - | - | N | one hold |
| 28 | `PATCH /v1/pending-holds/:id` | - | - | N | edit a hold |
| 29 | `DELETE /v1/pending-holds/:id` | - | - | N | delete a hold |
| 30 | `POST /v1/refund/request` | - | - | Y | client asks for refund |
| 31 | `POST /v1/refund/approve` | - | - | Y | consultant approves (full/partial) |
| 32 | `POST /v1/refund/reject` | - | - | Y | consultant rejects |
| 33 | `GET /v1/refund/pending-for-consultant` | - | - | Y | clients with open requests |
| 34 | `POST /v1/refund/auto-approval-claim/:id` | - | - | Y | claim the right to announce an auto-refund |
| 35 | `POST /v1/calls/type` | - | - | Y | record voice/video for a room |
| 36 | `GET /v1/calls/type` | - | - | Y | read it |
| 37 | `POST /v1/sessions/start` | - | - | N | legacy session hold |
| 38 | `POST /v1/sessions/adjust` | - | - | N | legacy fee adjust |
| 39 | `POST /v1/sessions/end` | - | - | N | legacy settle |
| 40 | `POST /v1/payouts/manual` | - | - | N | mock expert payout |
| 41 | `POST /v1/payouts/monthly` | - | - | N | mock monthly payout |
| 42 | `POST /v1/experts/bank-details` | - | - | Y | add bank details |
| 43 | `GET /v1/experts/:expertId/bank-details` | - | - | N | list bank details |

Per-route details follow in 2.2 - 2.8.

### 2.2 Auth routes (`src/auth/auth.controller.ts`, `auth.service.ts`)

Shared response object **`user`** (`PublicUser`): `{ id: uuid, email: string|null, username: string|null, name: string|null, matrixUserId: string|null, isConsultant: 0|1|null, isGoogleAccount: boolean }`. `passwordHash` and `googleId` are never returned. `isGoogleAccount = !passwordHash`.

#### #1 `POST /v1/auth/register` - 201 - throttle 10 / 900 s
- **Body (`RegisterDto`)**
  - `email`: `@IsEmail()` + `@MaxLength(255)`; message `A valid email address is required`. Not trimmed by the DTO (a leading/trailing space fails validation); the service then `trim().toLowerCase()`s it.
  - `password`: string, `@MinLength(8)` (`Password must be at least 8 characters`), `@MaxLength(200)`. No complexity rules.
  - `name`: string, `@MinLength(2)` (`Please enter your name`), `@MaxLength(255)`.
  - `username`: `@Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/)` + `@NotContains(' ')` (the DTO is case-insensitive on purpose); the service lowercases it and re-validates `/^[a-z0-9][a-z0-9._-]{2,29}$/`, and refuses a UUID-shaped handle (`400 That username is not available`).
  - `isConsultant`: optional int, `@IsIn([0,1])` (default 0).
  - Any other property => `400 property X should not exist`.
- **Response (201)**: `{ token: <JWT>, user }`.
- **Errors**: `400` (message array); `409 An account with that email already exists`; `409 The username "x" is already taken. Please choose another.` (raised by the DB unique index **or** by Synapse when the localpart exists - Synapse never frees the localpart of a deactivated account); `500` for Synapse/DB failures; `429`.
- **Side effects**: inserts the `users` row (UUID id, scrypt `passwordHash`); registers the Matrix account `@<username>:clarivahub.com` via shared-secret registration (non-admin, random password); best-effort sets the Matrix display name; stores `matrixUserId` and sets `Webuddy_name = matrixUserId` if empty. If Matrix provisioning (or the follow-up update) fails the Clariva row is **deleted** and the error propagates - but a Synapse account that was already created is **not** removed (it will block that username forever). The Matrix session obtained here is **discarded** (leaves one orphan device).

#### #2 `POST /v1/auth/login` - 200 - throttle 10 / 900 s
- **Body (`LoginDto`)**: `identifier?` (string, 3..255) **or** legacy `email?` (string, <=255); `password` (string, <=200; an empty string passes the DTO and then fails). If neither identifier nor email is sent the request reaches the service and returns 401.
- Lookup: trim + lowercase; contains `@` => exact match on `email`, otherwise exact match on `username`.
- **Response**: `{ token, user }` (no Matrix session is minted here).
- **Errors**: `401 Invalid email/username or password` for unknown account, wrong password, and passwordless (Google-only / pre-Clariva) accounts. Timing: unknown accounts burn a dummy scrypt; a Google-only account (null hash) returns immediately, a faint oracle for "this identifier is a Google-only account".

#### #3 `GET /v1/auth/username-available?username=` - 200 - default throttle 60 / 60 s
- Response `{ available: boolean, reason?: string }`. Invalid shape => `{available:false, reason:<validation text>}`; taken => `reason: "That username is already taken"`. Only the Wallet DB is consulted, **not Synapse**, so `available:true` can still be followed by a `409` at register (deactivated accounts).

#### #4 `GET /v1/auth/email-available?email=` - 200 - 30 / 900 s
- `{ available, reason? }`. `reason`: `Enter a valid email address` (empty, no `@`, or < 5 chars) or `That email is already registered`. Inherent enumeration oracle (hence the throttle).

#### #5 `POST /v1/auth/forgot-password` - 200 - 5 / 900 s
- **Body**: `email` (`@IsEmail`, <=255). **Response**: always `{ ok: true }` for a syntactically valid email (unknown email, Google-only account and SMTP failure are indistinguishable).
- **Side effects** (only for an account **with** a `passwordHash`): marks earlier unconsumed codes consumed, stores `HMAC-SHA256(pepper, "<email>:<code>")` with `expiresAt = now + 15 min`, and sends the 6-digit code **fire-and-forget** by SMTP (no SMTP configured => logged, nothing sent).

#### #6 `POST /v1/auth/reset-password` - 200 - 10 / 900 s
- **Body**: `email` (`@IsEmail`, <=255), `code` (`/^\d{6}$/`, `Enter the 6-digit code from your email`), `newPassword` (8..200).
- **Response** `{ ok: true }`; **no token is returned** (client must log in afterwards).
- **Error**: `400 That code is invalid or has expired. Please request a new one.` for every failure (no challenge / expired / 5 attempts used / wrong code / user gone). Attempts are counted atomically (`UPDATE ... WHERE attempts < 5`).
- **Not done**: existing JWTs and Matrix devices are **not** revoked.

#### #7 `POST /v1/auth/google` - 200 - 20 / 900 s
- **Body (`GoogleLoginDto`)**: `idToken` (string 20..4096), `isConsultant?` (int 0/1; **null is accepted** and means "not supplied"), `mode?` (`'signin'|'signup'`).
- **Verification**: signature/expiry/`aud` against `GOOGLE_CLIENT_IDS`, `iss` in {`accounts.google.com`, `https://accounts.google.com`}, `email_verified === true`, `sub` present. Account matched on the **verified email** (lower-cased).
- **Two possible 200 bodies**:
  1. Role needed (new account, or an existing row whose `isConsultant` is null, and the body has no role): `{ needsRole: true, email, name: string|null, isExisting: boolean }` - **nothing is created yet**; the client asks the user and re-posts with `isConsultant`.
  2. Signed in: `{ token, user }`.
- **Errors**: `401 Invalid Google credentials`; `401 Your Google account does not have a verified email address`; `409 An account with this email already exists. Please sign in instead.` (only when `mode:'signup'` and the email exists); `409` username-taken variants; `500 Google sign-in is not configured on this server (GOOGLE_CLIENT_IDS is empty)`; `500` Synapse errors.
- **Side effects**: new account => username derived from the email local part (lower-case, `[a-z0-9._-]`, <=24 chars, `user` prefix if < 3 chars; collisions get `2,3,...` up to 50 tries, then the account falls back to a UUID localpart with `username = null`), `googleId` stored, `name` = Google name or email local part, `passwordHash = null`, Matrix account provisioned (a Synapse-side clash advances to the next candidate), row deleted again if provisioning fails. Existing account => `googleId` set if empty, role back-filled only if null, `Webuddy_name`/`matrixUserId` healed if missing. **An existing email/password account is signed in as-is** (see finding E15).

#### #8 `GET /v1/auth/reauth-method?matrixUserId=` - 200 - 20 / 900 s
- `{ isGoogleAccount: boolean }`; returns `true` for unknown IDs (non-enumerating in that direction only).

#### #9 `POST /v1/auth/deactivate` - 200 - 5 / 900 s (no JWT by design)
- **Body (`DeactivateAccountDto`)**: `matrixUserId` (string <=255, required), `password?` (1..200), `googleIdToken?` (20..4096), `eraseData?` (boolean).
- **Proof**: password account => `password`; Google account (no hash) => a fresh Google ID token whose verified email equals the account email.
- **Response**: `{ deactivated: true }`. **Every proof failure** (unknown account, wrong/missing proof, Google mismatch) is `401 Could not verify your identity`; DTO problems are `400`.
- **Side effects**: Synapse admin `POST /_synapse/admin/v1/deactivate/{id}` with `{erase: eraseData}` (Synapse's GDPR-style "erase" flag: past messages stay visible to people who were in the room but are hidden from people who join later - not a purge; a Synapse 404 is tolerated), then **hard DELETE of the `users` row** (balance, role and credentials are gone; `wallet_transactions`, `pending_holds`, `refund_requests` rows stay orphaned; open holds that settle to a deleted consultant name are dropped). If `MATRIX_ADMIN_TOKEN` is missing => `500` and nothing is deleted. The Synapse localpart is permanently burned.

#### #10 `POST /v1/auth/matrix-session` - 200 - JWT
- **Headers**: `Authorization: Bearer <JWT>`; **no body**.
- **Response**: `{ userId: "@name:clarivahub.com", accessToken: string, deviceId: string, recoveryPassphrase: string }`.
- **Errors**: `401 Missing Bearer token` / `Invalid or expired token` / `Malformed token` / `Account no longer exists`; `409 Stored Matrix ID ... does not belong to this user ...` (tamper guard); `500 Matrix provisioning is not configured` / `Cannot issue a session ... MATRIX_ADMIN_TOKEN is not configured.` / `Matrix login failed for ...: M_*` / `Admin password rotation failed ...`.
- **Semantics**: see section 5.4 (a new device on every call).

#### #11 `GET /v1/auth/me` - 200 - JWT (not used by Android)
- `{ id, email }` taken from the token claims; it does **not** check that the account still exists.

### 2.3 User routes (`src/users/*`)

Returned user object (`toSafeUser`, all of the entity except `passwordHash`, `googleId`):
`{ id: uuid, phoneNumber: string|null, max_credits: "100.00", current_hold: "250.00", name, email, username, settings: object|null, Webuddy_name, matrixUserId, isConsultant: 0|1, createdAt: ISO, updatedAt: ISO }` - the two money fields are DECIMAL **strings** on reads (they may arrive as numbers right after `POST`, so always `Number()` them). **Android reads only `current_hold`, `max_credits`, `Webuddy_name`, `isConsultant`.**

#### #12 `POST /v1/users` - 201 - no auth, no throttle
- **Body (`CreateUserDto`)**: `phoneNumber?` string; `name?` string; `max_credits?` number (**no min/max**); `Webuddy_name?` string; `settings?` object; **`isConsultant` required** int in {0,1} (`isConsultant must be one of the following values: 0, 1` and `isConsultant must be an integer number` when omitted) [exec].
- **Idempotent for a known identity**: if `Webuddy_name` matches an existing row's `Webuddy_name` **or** `matrixUserId`, that row is returned (and its empty `Webuddy_name` is filled). Otherwise a row is inserted **and a brand-new Synapse account `@<uuid>:clarivahub.com` is created** (errors there are swallowed), with `matrixUserId` stored.
- Used by Android only as a self-heal (`ensureWalletUserExists`) when the local session lacks a `webuddyName`.

#### #13 `GET /v1/users/:Webuddy_name` - 200 / `404 User with Webuddy_name X not found`
- Path param must be URL-encoded (`%40alice%3Aclarivahub.com`). Lookup is by `Webuddy_name` only. Android calls this for itself (balance, role, own rate) **and for every chat partner** (their rate / role).

#### #14 `PATCH /v1/users/:Webuddy_name` - 200 / 404
- **Body (`UpdateUserDto`, all optional)**: `phoneNumber` string, `max_credits` number (**no bounds - a negative value is accepted [exec]**), `name` string, `Webuddy_name` string, `settings` object, `isConsultant` 0/1. `current_hold` is rejected (`property current_hold should not exist` [exec]).
- Android sends only `max_credits` (non-negative integer from a digits-only field) and `isConsultant`.
- Quirks: renaming `Webuddy_name` makes the handler re-read by the old name => `404` *after* the rename committed; a unique clash => `500`.

### 2.4 Wallet routes (`src/wallet/*`)

#### #15 `POST /v1/wallet/recharge` - 201
- **Body (`CreateOrderDto`)**: `userId` (non-empty string: UUID `id` or `Webuddy_name`), `amount` (`@IsNumber @Min(1) @Max(100000) @Type(()=>Number)` - rupees; numeric strings are coerced; **fractions are accepted** e.g. `10.555` [exec]). Anything else (e.g. `paymentMethod`, as in `api_endpoints.md`) => `400 property paymentMethod should not exist` [exec].
- **Response**: `{ userId (echo of input), amount, type: "RECHARGE", status: "CREATED", keyId, orderId, amountInPaise: int, currency: "INR", transactionId: "<string id>" }`. `amountInPaise = Math.round(amount*100)`; currency is hard-coded INR.
- **Errors**: `404 User not found`; `400 Failed to create payment order` (Razorpay failure - the `CREATED` ledger row stays); validation messages (`amount must not be less than 1`, `amount must not be greater than 100000`, `amount must be a number conforming to the specified constraints`, `userId should not be empty`).
- **Side effects**: `INSERT wallet_transactions (user_id, amount, 'INR', 'CREDIT', 'RECHARGE', 'CREATED', 'RAZORPAY')`, then `razorpay.orders.create({amount, currency:'INR', receipt:'recharge_<txnId>'})` (no `payment_capture`), then store `provider_order_id`. Not idempotent: each call is a new order.

#### #16 `POST /v1/wallet/verify` - 201
- **Body (`VerifyPaymentDto`)**: `userId` (string), `transactionId` (number; a numeric string such as the one returned by #15 is coerced), `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` (non-empty strings).
- **Flow**: resolve user (`404 User not found`) -> load txn by `id` **and** `user_id` (`404 Transaction not found`) -> `provider_order_id` must equal the supplied order id (`400 Order ID mismatch`) -> if already `PAID` return success (idempotent) -> compare `HMAC_SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET)` hex, constant time (`400 Invalid payment signature`, and the row is set to `FAILED`) -> in a DB transaction: `SELECT ... FOR UPDATE` the txn, re-check `PAID`, set `PAID` + `provider_payment_id` + `provider_signature`, lock the user row, `current_hold += txn.amount`, then the referral bonus (4.10).
- **Response**: `{ success: true, newBalance, transactionId: "<string>" }`. `newBalance` is a JS **number** on the first credit and the raw DECIMAL **string** (e.g. `"500.00"`) when the txn was already `PAID` (e.g. the webhook won the race) - Android declares `newBalance: Double`, so whether it tolerates the string form is **[unverified]**; a web client must accept both.
- The credited amount always comes from the DB row, never from the request.

#### #17 `POST /v1/wallet/webhook` - 201 (called by Razorpay)
- **Headers**: `x-razorpay-signature` = `HMAC_SHA256(raw body, RAZORPAY_WEBHOOK_SECRET)` hex. Missing secret/signature/body or a mismatch => `403 Webhook is not configured` / `Missing signature` / `Empty body` / `Invalid webhook signature`.
- **Events**: `payment.captured` -> find txn by `payment.entity.order_id`; if present and not `PAID`, credit exactly as #16 (idempotent, no signature stored); `payment.failed` -> `CREATED -> FAILED`. Anything else, or an unknown order, still returns `{ status: "ok" }` so Razorpay stops retrying.
- **Operational prerequisites**: the Razorpay dashboard webhook must point at `https://wallet.dranzo.com/v1/wallet/webhook`, subscribe to those two events and use the same secret; and **auto-capture must be enabled on the account**, because the order is created without `payment_capture` (otherwise `payment.captured` never fires and only `/verify` can credit).

#### #18 `GET /v1/wallet/history?userId=&page=&pageSize=`
- `userId` = UUID or `Webuddy_name` (`404 User not found` otherwise). `page` defaults to 1, `pageSize` to 10; **no validation**: non-numeric / `page<1` => SQL error => `500`; `pageSize=0` => `totalPages` is `Infinity` => serialised as `null`; a very large `pageSize` dumps the ledger.
- **Response**: `{ data: Row[], total: int, page: int, pageSize: int, totalPages: int }`, newest first. `Row = { id: "<string>", userId: <internal uuid>, amount: "500.00" (string), currency: "INR", type: "CREDIT"|"DEBIT"|"BONUS", source: "RECHARGE"|"HOLD"|"HOLD_SETTLED"|"REFUND"|"REFERRAL"|null, status: "CREATED"|"PAID"|"FAILED", provider: "RAZORPAY"|"SYSTEM", providerOrderId: string|null, providerPaymentId: string|null, createdAt: ISO }`. `CREATED` rows older than 1 hour (abandoned checkouts) are hidden from both the list and `total`. The sign of money is carried by `type` (amounts are always positive).

#### #19-#21 `CronController` - no auth (not used by Android)
- `GET /v1/wallet/cron` -> `{ jobs: [{name, description, schedule, manualTrigger}, ...] }`.
- `POST /v1/wallet/cron/pending-holds/trigger` (200) -> awaits `handleCron()` -> `{ message, timestamp }`.
- `POST /v1/wallet/cron/monthly-payouts/trigger` (200) -> awaits `handleMonthlyPayoutCron()` -> `{ message, timestamp }`.
- **Anyone can run both jobs, concurrently, at any time** (settlement race R1, 6.8).

### 2.5 Pending-hold routes (`src/pending-holds/*`)

Identifiers here are raw **strings stored verbatim** in `clientId` / `consultandId` (note the historic spelling `consultandId`), normally the `Webuddy_name`s.

#### #22 `GET /v1/pending-holds/exists?clientId=&consultantId=` -> `{ exists: boolean }`
- True when a hold exists for **that directional pair** (`clientId` pays `consultantId`) with `createdAt` within the last 24h **and** `refund_status != 'approved'`. This deliberately mirrors the re-use rule of `initiate`: it answers "would a new message cost nothing?". It stays `true` after a rejected refund or a partial-refund remainder (where `isRefundActive` is 0).

#### #23 `GET /v1/pending-holds/status?clientId=&consultantId=` (the two ids are treated as an unordered pair)
- Response always has the same keys:
  `{ exists: boolean, pendingHoldId: number|null, refund_status: "none"|"requested"|"approved"|"rejected", clientId: string|null, consultantId: string|null, amount: number|null, refundRequestId: number|null, pendingAutoApprovalNotification: { refundRequestId: number, amount: number, clientId: string, consultantId: string } | null }`.
- `exists` = the newest hold of the pair (either direction) with `isRefundActive = 1` - **regardless of age**. `isActive` / `isRefundActive` are **not** in the response (Android defaults them to 1). `refundRequestId` is filled only when `refund_status = 'requested'`. `pendingAutoApprovalNotification` is non-null when an auto-approved refund of the last 7 days between the pair still has `notification_sent = 0`, **even if no hold exists any more** (the hold is deleted on auto-approval). Android polls this every 15 s per open DM.

#### #24 `POST /v1/pending-holds/initiate` - 201
- **Body (`InitiateHoldDto`)**: `clientId`, `consultantId` (non-empty strings).
- **Response**: the `PendingHold` entity: `{ id: number, clientId, consultandId, pending: "INITIATED", isActive: 0|1, amount: number (new) | "100.00" string (re-used), refund_status, isRefundActive, createdAt, updatedAt }`. Android ignores the body.
- **Errors**: `404 Consultant X not found`; `404 Client X not found`; `403 Consultants cannot initiate a chat hold` (client's `isConsultant == 1`); `400 Insufficient credits: need N, have M. Please recharge to start this chat.` (only on the *new-hold* path).
- **Semantics**: one DB transaction; client row locked `FOR UPDATE`. Re-use: a hold for the same directional pair, created in the last 24h, `refund_status != 'approved'` => set `isActive = 1`, **no charge, amount untouched**. Otherwise: amount = **consultant's current `max_credits`**, client `current_hold -= amount`, insert hold (`isActive 0`, `pending 'INITIATED'`, `refund_status 'none'`, `isRefundActive 1`), ledger `DEBIT / HOLD`. The target is **not** required to be flagged `isConsultant`. A `max_credits` of 0 creates a zero-amount hold.

#### #25-#29 raw CRUD (no auth; not used by Android)
- `POST /v1/pending-holds/create` (`CreatePendingHoldDto`: `clientId`, `consultandId` non-empty strings; `pending?` string; `isActive?` number; `amount?` number, **unbounded**) -> inserts a hold with **no balance movement**; it will be settled to `consultandId` by the cron.
- `GET /v1/pending-holds/all` -> every hold. `GET /v1/pending-holds/:id` -> one (`404 PendingHold with ID N not found`; non-numeric id => `NaN` => 404). `PATCH /v1/pending-holds/:id` (`UpdatePendingHoldDto`: `clientId?`, `consultandId?`, `pending?`, `isActive?`, `amount?`; refund fields are not whitelisted) -> edits. `DELETE /v1/pending-holds/:id` -> deletes the escrow row without refunding anyone.

### 2.6 Refund routes (`src/refunds/*`; bodies are **not validated** - inline types)

Ids may be sent as numbers or numeric strings (`parseInt`); a missing/garbage id becomes `NaN` => `= NULL` => a 404.

#### #30 `POST /v1/refund/request` - 201
- **Body**: `{ clientId, consultantId, pendingHoldId }`.
- **Response**: `{ message: "Refund requested successfully", refundRequestId: number }` (no `success` field).
- **Errors**: `404 Pending hold not found for the provided details` (hold looked up by `id` + `consultandId` + `clientId`); `400 Refund process for this hold is not active` (`isRefundActive != 1`); `400 Refund has already been requested`; `400 Refund has already been approved`.
- **Effects**: insert `refund_requests` (`status 'requested'`, `amount = hold.amount`, `notification_sent 0`), set `hold.refund_status = 'requested'`. There is **no row lock and no age check**.

#### #31 `POST /v1/refund/approve` - 201
- **Body**: `{ refundRequestId, pendingHoldId, refundAmount? }`. `refundAmount` absent / `null` / blank => **full** refund; present => **partial**: `0 < refundAmount <= held` (rounded to 2 dp).
- **Response**: `{ message, amount: number (returned to client), toConsultant: number, isAutomatic: false }`.
- **Errors**: `404 Refund request not found` (lookup by `id` + `pendingHoldId`); `400 Refund is not awaiting a decision (current status: X).`; `404 Pending hold not found`; `400 Refund amount must be greater than 0 and at most the held amount (N).`; `404 Client X not found`.
- **Effects** (single transaction, hold row and client row locked): `client.current_hold += toClient`, ledger `CREDIT / REFUND`; `refund_requests.status = 'approved'`, `amount = toClient`, `notification_sent = 1`; **full**: hold deleted; **partial**: hold kept with `amount = remainder`, `refund_status 'none'`, `isRefundActive 0`, `isActive 0` (the remainder is paid to the consultant by the cron at the original 24h mark).

#### #32 `POST /v1/refund/reject` - 201
- **Body**: `{ refundRequestId }`. **Response** `{ message: "Refund rejected; funds will transfer to consultant after hold expiry" }`. `404 Refund request not found` / `404 Pending hold not found`.
- **Effects**: request `rejected` (+`notification_sent 1`), hold `refund_status 'rejected'`, `isRefundActive 0`. **No guard on the request's current state** (a request already `approved` after a partial refund can be flipped to `rejected`, corrupting the audit trail; money is unaffected).

#### #33 `GET /v1/refund/pending-for-consultant?consultantId=` -> `{ clientIds: string[] }`
- Distinct `clientId`s of holds with `consultandId = consultantId`, `refund_status = 'requested'`, `isRefundActive = 1`; empty list when the param is empty.

#### #34 `POST /v1/refund/auto-approval-claim/:id` - 201
- **Body**: `{ userId }` (self-asserted). `400 Invalid refund request id` / `Missing callerUserId`. **Response** `{ claimed: boolean }`: a single atomic `UPDATE ... SET notification_sent = 1 WHERE id=? AND status='approved' AND notification_sent=0 AND (clientId=? OR consultantId=?)`. The winner is expected to post an `m.room.message` in the DM (this is what push-notifies the other party). A web client must therefore implement claim + announce too.

### 2.7 Call-type routes (`src/calls/*`)

- `POST /v1/calls/type` (201) body `{ roomId (string <=255), callType: "voice"|"video", callerId? }` (inline type, not DTO-validated; checked in the service) -> upserts one row per room -> `{ roomId, callType }`. Errors `400 Invalid roomId`, `400 callType must be 'voice' or 'video'`.
- `GET /v1/calls/type?roomId=` -> `{ roomId, callType: "voice"|"video"|null, updatedAt: ISO|null }`; `400 roomId is required`.
- **TTL: none.** The row lives until the next call in that room overwrites it; there is no expiry and nothing ties it to a call id, so a stale value is returned for any later call whose caller did not record one. Android ignores `updatedAt`; a web client should reject values older than a few minutes. Anyone can overwrite any room's value.

### 2.8 Legacy modules (none used by Android except bank-details POST)

#### Sessions (`/v1/sessions/*`, 201) - uses `users.id` (UUID) and the **old** `max_credits - current_hold` credit-limit model
- `POST start` `{userId, expertId, sessionFee}` (`sessionFee >= 0`): requires `max_credits - current_hold >= sessionFee`, inserts an `ACTIVE` session + `transactions` row (`SESSION_HOLD`) and then **adds** `sessionFee` to `current_hold`. Returns the `Session`.
- `POST adjust` `{sessionId, adjustedFee >= 0, deferFee: boolean}`: for an `ACTIVE` session changes `expectedFee` and adds the difference (any amount) to the user's `current_hold`.
- `POST end` `{sessionId, expertId, actualFee >= 0}`: `current_hold -= expectedFee`, `max_credits -= actualFee`, credits `experts.currentWalletBalance` with `actualFee * 0.9` (mock 10 % commission) if the expert exists, writes `SESSION_CAPTURE` + `COMMISSION` rows, status `SETTLED`.
- Errors `404 User not found` / `Session not found`, `400 Insufficient credits` / `Session is not active`. No locks. **Because `current_hold` is now the real wallet balance, `start` + `adjust` mint balance** (finding E1).

#### Payouts (`/v1/payouts/*`, 201)
- `POST manual` `{expertId (experts.id), amount >= 1, bankAccount, paymentMethod: "RAZORPAY"|"STRIPE"}` and `POST monthly` `{expertId, month, payoutThreshold >= 0}`: debit `experts.currentWalletBalance`, write a `PAYOUT` row in `transactions` with status `SUCCESS` ("Mocking success"). No gateway call. `404 Expert not found`, `400 Insufficient wallet balance` / `Balance X is below threshold Y`.

#### Experts (`/v1/experts/*`)
- `POST bank-details` (201) `AddBankDetailDto`: `expertId`, `bankName`, `accountNumber`, `ifscCode`, `accountHolderName` (non-empty strings, **no format/length rules**), `branchName?`. Requires an **`experts` row whose `id` equals `expertId`** (`404 Expert with ID X not found`). Returns the `BankDetail` (account number in clear). No update/delete route.
- `GET :expertId/bank-details` -> array of `BankDetail` rows (`id, expertId, bankName, accountNumber, ifscCode, accountHolderName, branchName, isActive, createdAt, updatedAt`) - unauthenticated.
- No route creates `experts` rows, and Android sends the user's **Matrix ID** (`matrixClient.sessionId`) as `expertId` (46 chars for a 30-character handle vs. `experts.id varchar(36)`), so for Clariva users this call almost certainly returns 404 **[infer; unverified against production data]**.

### 2.9 Contract fence for backend changes

**Fields the Android client actually decodes** (kotlinx `Json { ignoreUnknownKeys = true }`, *not* lenient: a bare JSON number sent into a Kotlin `String` field - history `amount` - is rejected, and tolerance of quoted numbers in numeric fields depends on the library version, so **do not change any wire type**): `WalletResponse{current_hold, max_credits, Webuddy_name, isConsultant}`; `CreateOrderResponse{keyId, orderId, amountInPaise: Long, currency, transactionId: String}`; `VerifyPaymentResponse{success, newBalance: Double, transactionId: String}`; `TransactionHistoryResponse{data[]{id, userId, amount: **String**, type, status, source, metaData?, createdAt}, total, page, pageSize, totalPages: Int}`; `PendingHoldStatusResponse{exists, isActive, isRefundActive, refund_status, pendingHoldId, id, clientId, consultantId, amount: Double?, refundRequestId, pendingAutoApprovalNotification}`; `HoldExistsResponse{exists}`; `RefundResponse{message, refundRequestId: Int?}`; `GenericRefundResponse{message, amount: Double?}`; `PendingRefundsForConsultantResponse{clientIds}`; `ClaimAutoApprovalResponse{claimed}`; `CallTypeResponse{roomId, callType, updatedAt}`; auth: `ClarivaAuthResponse{token, user{id,email,username,name,matrixUserId,isConsultant,isGoogleAccount}}`, `ClarivaGoogleResponse{needsRole,email,name,isExisting,token,user}`, `ClarivaMatrixSessionResponse{userId, accessToken, deviceId, recoveryPassphrase?}`, `ClarivaUsernameAvailability`, `ClarivaEmailAvailability`, `ClarivaOkResponse{ok}`, `ClarivaReauthMethod`, `ClarivaDeactivateResponse{deactivated}`.
Anything outside these sets can be added, removed or re-typed without touching Android - **except** that history `amount` must stay a string and `newBalance` must stay a number. Android's request bodies are exactly the DTOs of section 2 (Kotlin nulls are omitted, `isConsultant` is force-emitted on register / create).

**Numeric wire types (what a second client must tolerate)**

| Field | Wire type |
|---|---|
| `users.current_hold`, `users.max_credits` (GET/PATCH/POST /v1/users) | string `"250.00"` (sometimes number right after POST) |
| history `data[].amount` | string `"500.00"` |
| `verify.newBalance` | number on first credit; string on the idempotent repeat |
| `recharge.amountInPaise` | integer; `recharge.amount` echoes the request number; `transactionId` string |
| `initiate` response `amount` | number (new hold) / string (re-used hold) |
| `status.amount`, refund `amount`, `toConsultant`, notification `amount` | number |
| ids `pendingHoldId`, `refundRequestId` (responses) | number; requests accept number or numeric string |
| dates | ISO-8601 strings produced from JS `Date`; correct only if Node's TZ equals MySQL's session TZ (6.8, B10) |

---

## 3. Entities and database schema

**Caveat.** The repository does **not** contain a complete DDL. `database/init.sql` creates only `users` (old shape), `experts`, `sessions`, `transactions`; four dated scripts add `matrixUserId`, `email`/`passwordHash`, `googleId`, `username` to `users`; `create_bank_details_table.sql` and `migrate.js` add `bank_details`, `pending_holds.refund_status`/`isRefundActive` and `refund_requests`; `password_resets`, `call_intents`, `refund_requests.notification_sent` and five indexes are created **by the application at boot**. `wallet_transactions`, the base `pending_holds` table and `referrals` exist only in the live DB (and in a dev script). Where a table has no DDL here, the columns below are reconstructed from entities / raw SQL and marked *(inferred)*. `synchronize` is `false`; there are **no foreign keys** between wallet tables (references are plain strings), the only FK being `bank_details.expertId -> experts.id` in the SQL file.

### 3.1 `users` (entity `User`)

| Column | Type | Null / default | Index | Meaning |
|---|---|---|---|---|
| `id` | varchar(36) | PK, TypeORM-generated UUID v4 | PK | Immutable account id. Alias accepted by `wallet/*` routes. Legacy Matrix localpart. |
| `phoneNumber` | varchar(255) | null (entity); `init.sql` said NOT NULL | UNIQUE `IDX_users_phoneNumber` | Pre-Clariva identity. Unused by Clariva auth. |
| `max_credits` | decimal(10,2) | NOT NULL, 0.00 | | **Consultant's price for one 24h chat window** (INR). For clients it is meaningless (in the legacy `sessions` model it was a credit limit). Editable through `PATCH /v1/users` (no bounds). |
| `current_hold` | decimal(10,2) | NOT NULL, 0.00 | | **The wallet balance (INR).** (Name is historical.) Credited by recharge, refund, settlement, referral; debited by new holds. |
| `name` | varchar(255) | null | | Display name (also set as Matrix display name). |
| `email` | varchar(255) | null | UNIQUE `IDX_users_email` | Lower-cased sign-in identity. NULL on pre-Clariva rows (34 existed when email auth was added). |
| `username` | varchar(255) | null | UNIQUE `IDX_users_username` | Lower-case handle `^[a-z0-9][a-z0-9._-]{2,29}$`; becomes the Matrix localpart. NULL for legacy rows and for Google accounts whose derived-handle allocation was exhausted (they use a UUID localpart). |
| `passwordHash` | varchar(255) | null | | `scrypt$16384$8$1$<salt-b64>$<hash-b64>`. NULL = Google-only (or legacy) account. |
| `googleId` | varchar(255) | null | | Google `sub`, audit/link only (matching is by verified email). |
| `settings` | json | null | | Free-form; unused by Clariva flows. |
| `Webuddy_name` | varchar(255) | null | UNIQUE (`users.Webuddy_name`) + a redundant `idx_users_webuddy_name` | **Wallet identity string** used as `clientId` / `consultandId` / path key everywhere. Equals `matrixUserId` for every Clariva-provisioned account; legacy rows hold old matrix.org MXIDs. Duplicate => `500` (`ER_DUP_ENTRY`). |
| `matrixUserId` | varchar(255) | null | UNIQUE `IDX_users_matrixUserId` | Authoritative full Matrix ID `@name:clarivahub.com`. Once set it is never re-derived. |
| `isConsultant` | tinyint(1) | NOT NULL, 0 (entity) | | 0 client, 1 consultant. The Google flow treats a **NULL** as "role unknown" and asks; whether the live column permits NULL is **[unverified]**. |
| `createdAt`, `updatedAt` | datetime(6) | CURRENT_TIMESTAMP(6) | | |

### 3.2 `wallet_transactions` (raw SQL only - *inferred*)

The real money ledger (history endpoint, recharge, holds, refunds, settlements). Not a TypeORM entity.

| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT PK | `insertId` is returned to clients as the string `transactionId`. |
| `user_id` | varchar(36) | `users.id` (no FK). Index `idx_txn_user (user_id)` ensured at boot. |
| `amount` | DECIMAL (2 dp) | Always positive; the sign is in `txn_type`. Returned as a string. |
| `currency` | varchar | Always `'INR'`. |
| `txn_type` | varchar/enum | `CREDIT` (recharge, refund, settlement), `DEBIT` (new hold), `BONUS` (referral). Exposed as `type`. |
| `source` | varchar | `RECHARGE`, `HOLD`, `HOLD_SETTLED`, `REFUND`, `REFERRAL` (older rows may be NULL). |
| `status` | varchar/enum | `CREATED` (order opened), `PAID`, `FAILED`. System entries are inserted directly as `PAID`. |
| `provider` | varchar | `RAZORPAY` or `SYSTEM`. |
| `provider_order_id`, `provider_payment_id`, `provider_signature` | varchar | Filled by recharge / verify / webhook. **No index on `provider_order_id`** although verify / webhook look rows up by it. |
| `created_at` | datetime/timestamp | default `CURRENT_TIMESTAMP`. |

### 3.3 `pending_holds` (entity `PendingHold`) - the escrow

| Column | Type | Null / default | Meaning |
|---|---|---|---|
| `id` | int AI PK | | exposed as `pendingHoldId` |
| `clientId` | varchar | NOT NULL | payer (`Webuddy_name`) |
| `consultandId` | varchar | NOT NULL | payee (`Webuddy_name`) - spelling is part of the schema |
| `pending` | varchar | null | free text; `'INITIATED'` on creation |
| `isActive` | tinyint | null, default 1 | `initiate` sets **0** on a new hold and **1** when a later send re-uses it; partial refund sets 0. Not used by any gate today (the old gating on this flag was replaced by the `createdAt`/`refund_status` rule). |
| `amount` | decimal(10,2) | null | amount parked (consultant's rate at creation; frozen on re-use; reduced to the remainder after a partial refund) |
| `refund_status` | enum('none','requested','approved','rejected') | default 'none' | refund state of the hold (4.5). `'approved'` is transient - approval deletes the hold (full) or resets it to `'none'` (partial). |
| `isRefundActive` | tinyint | null, default 1 | 1 = a refund can still be requested / decided; 0 after rejection or after a partial approval. `status`, `pending-for-consultant` and `requestRefund` all require 1. |
| `createdAt`, `updatedAt` | datetime(6) | | `createdAt` anchors the 24h re-use and settlement windows (a partial refund leaves it untouched). |

Indexes ensured at boot: `idx_holds_client_consultant (clientId, consultandId, createdAt)`, `idx_holds_consultant_refund (consultandId, refund_status, isRefundActive)`.

### 3.4 `refund_requests` (entity `RefundRequest`) - the refund audit record

| Column | Type | Meaning |
|---|---|---|
| `id` | int AI PK | `refundRequestId` |
| `clientId`, `consultantId` | varchar | parties (`Webuddy_name`s) |
| `pendingHoldId` | int | the hold (no FK; the hold row is deleted on full refund) |
| `amount` | decimal(10,2) null | held amount at request time; **overwritten with the amount actually refunded** on approval |
| `status` | enum('requested','approved','rejected') default 'requested' | |
| `notification_sent` | tinyint(1) NOT NULL default 0 | 0 = the apps still owe the DM announcement of an auto-approval; 1 = announced / claimed / manual flow. Added at boot if missing (old rows back-filled to 1). |
| `createdAt`, `updatedAt` | datetime(6) (the `migrate.js` DDL is second-precision `DATETIME`) | `createdAt` starts the consultant's 24h response clock. |

Index ensured at boot: `idx_refunds_hold_status (pendingHoldId, status)`. **No index serves `findPendingAutoApprovalForPair`** (`status`, `notification_sent`, `createdAt`, `clientId`/`consultantId`), which runs on every 15 s `status` poll.

### 3.5 `password_resets` (entity `PasswordReset`, created at boot)

`id INT AI PK`, `email VARCHAR(255)` (normalised), `codeHash VARCHAR(128)` (HMAC-SHA256 hex), `expiresAt DATETIME`, `attempts INT default 0`, `consumed TINYINT default 0`, `createdAt DATETIME default CURRENT_TIMESTAMP`, `INDEX idx_password_resets_email (email)`. Rows are never deleted (only marked consumed).

### 3.6 `call_intents` (entity `CallIntent`, created at boot)

`roomId VARCHAR(255) PK`, `callType ENUM('voice','video') default 'voice'`, `callerId VARCHAR(255) null`, `updatedAt DATETIME default CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`. One row per room, overwritten; never purged.

### 3.7 `experts` and `bank_details` (legacy)

- `experts`: `id varchar(36) PK (uuid)`, `expertId varchar(255) UNIQUE`, `bankAccountDetails json NOT NULL`, `currentWalletBalance decimal(10,2) default 0`, timestamps. **No code path creates a row.**
- `bank_details`: `id varchar(36) PK`, `expertId` (FK -> `experts.id` ON DELETE CASCADE in `create_bank_details_table.sql`, although git history says the constraint / NOT NULL were later removed in the live DB **[unverified]**), `bankName`, `accountNumber`, `ifscCode`, `accountHolderName` (varchar(255) NOT NULL, **plaintext**), `branchName` null, `isActive tinyint default 1`, timestamps.

### 3.8 `sessions` and `transactions` (legacy session ledger; written only by `/v1/sessions/*` and `/v1/payouts/*`)

- `sessions`: `id` uuid, `userId` (= `users.id`), `expertId`, `startTime`, `endTime`, `expectedFee`, `actualFee` (decimal(10,2)), `status` enum(`ACTIVE`,`COMPLETED`,`SETTLED`,`CANCELLED`), timestamps. `COMPLETED`/`CANCELLED` are never set.
- `transactions`: `id` uuid, `userId`, `expertId`, `amount decimal(10,2)`, `type` enum(`RECHARGE`,`SESSION_HOLD`,`SESSION_CAPTURE`,`SESSION_REFUND`,`PAYOUT`,`COMMISSION`,`ADJUSTMENT`), `status` enum(`PENDING`,`SUCCESS`,`FAILED`), `referenceId`, `metaData json`, timestamps. **Separate from `wallet_transactions`** - Android's history never shows these rows.

### 3.9 `referrals` (raw SQL; created by `scratch/create_referrals_table.js`, which is committed)

`id INT AI PK`, `referrer_user_id varchar(36)`, `referred_user_id varchar(36)`, `status ENUM('PENDING','REWARDED') default 'PENDING'`, `first_recharge_txn_id INT null`, `createdAt TIMESTAMP`, indexes on `referred_user_id`, `status`. **No API creates referral rows**; the bonus code (4.10) is dormant unless rows are inserted manually. Existence in production is **[unverified]**.

### 3.10 Logical relationships (none are enforced by foreign keys except `bank_details -> experts`)

- `pending_holds.clientId` / `consultandId` and `refund_requests.clientId` / `consultantId` hold **`users.Webuddy_name` strings** (not ids); `refund_requests.pendingHoldId -> pending_holds.id`.
- `wallet_transactions.user_id -> users.id`; `sessions.userId -> users.id`; `sessions.expertId -> experts.id` (free text, not validated); `bank_details.expertId -> experts.id`; `password_resets.email -> users.email`; `call_intents.roomId` is a Matrix room id (no local table).
- Deleting a user (deactivation) therefore orphans ledger, hold and refund rows; a hold whose `consultandId` no longer resolves is deleted by the cron without paying anyone.

### 3.11 Key-field glossary

| Field | Meaning |
|---|---|
| `users.current_hold` | wallet balance in INR - **not** "amount on hold" |
| `users.max_credits` | consultant's chat price per 24h window (INR); amount escrowed per hold |
| `users.Webuddy_name` | wallet identity string; = Matrix ID for Clariva accounts; the key of every wallet URL / body |
| `users.isConsultant` | role: 1 earns and cannot initiate holds; 0 pays |
| `users.matrixUserId` | the account's Synapse user id; authoritative, never re-derived |
| `users.username` / `id` | handle (Matrix localpart for new accounts) / UUID (localpart for legacy accounts) |
| `pending_holds.refund_status` | `none` default; `requested` after the client asks; `rejected` after the consultant refuses; `approved` is transient |
| `pending_holds.isRefundActive` | 1 while a refund can still be requested / answered; 0 once resolved |
| `pending_holds.isActive` | 0 = first hold of the window, 1 = re-used by a later message, 0 again after a partial refund (informational) |
| `wallet_transactions.txn_type / source / status` | `CREDIT`,`DEBIT`,`BONUS` / `RECHARGE`,`HOLD`,`HOLD_SETTLED`,`REFUND`,`REFERRAL` / `CREATED`,`PAID`,`FAILED` |

---

## 4. Business logic

### 4.1 Money model **[code]**

- Unit: **INR rupees**; Android displays them as "credits", 1 credit = INR 1. `DECIMAL(10,2)` caps any balance / price at 99,999,999.99; JS floats are used for read-modify-write and the DB rounds on store (the refund path rounds explicitly with `round2`).
- **Balance** = `users.current_hold`. **Price** = `consultant.max_credits` per 24h window per client.
- **There is no platform fee in the hold flow**: the consultant is credited 100 % of the held amount. (The 10 % commission exists only in the legacy `sessions/end`.)
- **Consultant earnings stay in `users.current_hold`**; no endpoint withdraws them. The payouts module drains a *different* ledger (`experts.currentWalletBalance`) that the hold flow never credits, and it makes no gateway call. Treat cash-out as an offline / manual process.

### 4.2 Wallet recharge (Razorpay) **[code]**

1. `POST /v1/wallet/recharge {userId, amount}` -> ledger row `CREATED` -> Razorpay order (`amount` in paise, `INR`, `receipt recharge_<txnId>`) -> response with `keyId`, `orderId`, `amountInPaise`, `currency`, `transactionId`.
2. The client opens Razorpay Checkout (Android passes name `Clariva`, description `Wallet Recharge`, theme `#3399cc`, `order_id`, `currency INR`, `amount` paise) and receives `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`.
3. **Credit path A - client**: `POST /v1/wallet/verify` with those three values + `userId` + `transactionId`. Server recomputes `HMAC_SHA256(order_id|payment_id, KEY_SECRET)`, compares in constant time, then credits **inside one DB transaction** with row locks (txn row, then user row). A bad signature marks the row `FAILED` and returns `400 Invalid payment signature`.
4. **Credit path B - webhook**: `payment.captured` (raw-body HMAC with the webhook secret) credits the same txn if it is not yet `PAID`; `payment.failed` flips `CREATED -> FAILED`.
5. **Idempotency**: both paths lock the txn row and re-check `PAID`, so a credit happens exactly once whichever arrives first; `verify` after the webhook returns success (with `newBalance` as a DECIMAL string). A `FAILED` row can still be credited later by a valid signature / webhook (Razorpay allows several attempts per order).
6. Abandoned `CREATED` rows are never cleaned up; the history endpoint merely hides them after 1 hour.
7. **Stripe**: not implemented. The `STRIPE` enum value exists only in `RechargeWalletDto`, which no controller uses; `stripe` is an unused dependency; there are no Stripe env vars or routes. `api_endpoints.md` is wrong to list it for recharge.
8. Limits: INR only, `1 <= amount <= 100000` per order, fractions allowed (possible 1-paisa mismatch between `Math.round(amount*100)` and the DECIMAL(10,2) stored amount for inputs with > 2 decimals).

### 4.3 Chat holds (the pay-per-24h-window mechanism) **[code]**

- **Who pays whom / how much / when**: when a *client* (non-consultant) sends in a DM, Android calls `POST /v1/pending-holds/initiate {clientId: me, consultantId: peer}` for **every outgoing text and voice message** (fire-and-forget, issued *after* the message has already been handed to the Matrix SDK) and once more when the callee **answers a call** (watched for up to 2 minutes). It is skipped for consultants and for non-DM rooms. The server moves `peer.max_credits` from `client.current_hold` into a new `pending_holds` row **only if no qualifying hold exists**. The server cannot block a message (Matrix delivery is independent of this API); the paywall is a **client-side composer gate**, so a web client must implement the same gate itself.
- **Qualifying (re-usable) hold**: same directional pair, `createdAt` within the last 24h (hard-coded), `refund_status != 'approved'` (so `none`, `requested` and `rejected` all re-use). Re-use sets `isActive = 1`, charges nothing and never changes the stored amount (so a consultant's later price change cannot create or destroy money).
- **Insufficient balance** -> `400 Insufficient credits: need N, have M ...` (new-hold path only), no hold is created.
- **Gating on the client** (Android): the composer is restricted when `exists == false` and `balance < recipient rate`; `exists` is refreshed on chat open and every 60 s, the balance and the recipient's rate at the same cadence.
- **Settlement** (4.4) pays the consultant at hold-age >= 24h unless a refund is pending.
- `max_credits = 0` yields free chats (a zero-amount hold row and a zero ledger line). The payee is not checked to be a consultant. Nothing validates that a Matrix DM exists between the two users.

### 4.4 Settlement cron (`PendingHoldsCronService`) **[code]**

Runs hourly (`0 0-23/1 * * *`, server-local) and on demand via `POST /v1/wallet/cron/pending-holds/trigger`. It loads every hold with `createdAt < now - HOLD_SETTLE_WINDOW_MS` (24h; env-overridable at process level) and processes them one by one:

| `refund_status` | Action |
|---|---|
| `none`, `rejected` | credit `consultandId` (`Webuddy_name` lookup, row locked) with `hold.amount`, ledger `CREDIT / HOLD_SETTLED / PAID / SYSTEM`, delete the hold. If the consultant row no longer exists the hold is **deleted anyway** (money disappears, warning logged). |
| `approved` | clean-up only (delete). Should not occur. |
| `requested` | find the newest open `refund_requests` row. None -> leave untouched (warn). If `now - request.createdAt >= REFUND_RESPONSE_WINDOW_MS` (24h) -> `approveRefund(..., isAutomatic = true)` (full refund, `notification_sent = 0`); otherwise skip until a later pass. |

Consequences: settlement lands 24-25h after the *first* message; an auto-refund happens at `max(hold age >= 24h, request age >= 24h)`, at hourly granularity, i.e. a refund requested 1h into the window is auto-approved ~25h after the hold, not 24h after the request. There is no leader election, no re-check of the hold inside the settlement transaction and no re-entrancy guard (race R1).

### 4.5 Refund state machine **[code]**

Hold states are written `hold(refund_status, isRefundActive)`; request states `req(status)`.

| # | From | Trigger | Guards | To | Money |
|---|---|---|---|---|---|
| T1 | (no hold) | `initiate` | balance >= consultant `max_credits`; payer not a consultant | `hold(none, 1)` | client `-= price`, ledger `DEBIT/HOLD` |
| T2 | `hold(none\|requested\|rejected, *)` < 24h old | `initiate` again | - | same hold, `isActive = 1` | none |
| T3 | `hold(none, 1)` | `refund/request` | hold matches `id+clientId+consultandId`; `isRefundActive = 1`; not already requested / approved | `hold(requested, 1)` + `req(requested)` (`amount = hold.amount`) | none |
| T4 | `req(requested)` | `refund/approve` **full** | `req.status = requested`; hold exists | hold **deleted**, `req(approved, notification_sent = 1)` | client `+= held`, ledger `CREDIT/REFUND` |
| T5 | `req(requested)` | `refund/approve` **partial** `x` | `0 < x <= held` | `hold(none, 0)` with `amount = held - x`, `isActive = 0`; `req(approved, amount = x)` | client `+= x`; remainder stays escrowed |
| T6 | `req(requested)` | `refund/reject` | (none - state is not checked) | `hold(rejected, 0)`, `req(rejected)` | none |
| T7 | `hold(requested, 1)` | cron, hold >= 24h **and** `req.createdAt` >= 24h ago | open `req` exists | like T4 but `isAutomatic`: hold deleted, `req(approved, notification_sent = 0)` | client `+= held` |
| T8 | `hold(requested, 1)` | cron, request < 24h old | - | unchanged, re-checked next hour | none |
| T9 | `hold(none\|rejected, *)` | cron, hold >= 24h | - | hold **deleted** | consultant `+= amount`, ledger `CREDIT/HOLD_SETTLED` (this also pays out the partial-refund remainder of T5) |
| T10 | `req(approved, notification_sent = 0)` | `auto-approval-claim` by client or consultant of the row | atomic update | `notification_sent = 1` | none; the claimant posts an `m.room.message` in the DM |

Guards that exist (and should be preserved): `requestRefund` needs a hold matching `id + clientId + consultandId`, `isRefundActive = 1` and `refund_status` not `requested` / `approved`; `approveRefund` only acts on a `refund_requests` row whose `status = 'requested'` (so a *rejected* request cannot be re-approved), locks the hold and then the client row, bounds a partial refund to `0 < x <= held`, rounds with `round2`, never pays the consultant immediately on a partial refund (remainder stays escrowed for the cron), deletes the hold on a full refund so the next chat opens a fresh one, and writes a ledger line; `initiateHold` refuses insufficient balance, refuses consultants as payers and never re-prices a re-used hold; the claim endpoint is a single atomic `UPDATE`.

Guards that are **missing** (the weaknesses):

1. **No caller identity anywhere**: the client can request *and approve* its own refund; anyone can approve / reject any request (E6).
2. `requestRefund` has no lock -> two concurrent requests create two `requested` rows for one hold (R2).
3. `approveRefund` reads the `refund_requests` row *before* taking the hold lock (snapshot read); two concurrent approvals of a **partial** refund both pass the status check (R3).
4. `rejectRefund` ignores the request's state.
5. No time limit on requesting (only the 24h-settlement cron ends it) and no cap on refund count per pair.
6. The partial-refund amount is whatever the (unauthenticated) caller sends, bounded only by the held amount.

### 4.6 Payouts **[code]**

Mock. `POST /v1/payouts/manual|monthly` and the monthly cron debit `experts.currentWalletBalance` and record a `PAYOUT` row in `transactions`. Nothing credits that balance in the current flow, nothing contacts Razorpay / Stripe / a bank, and Android never calls it. Bank details (`POST /v1/experts/bank-details`) are stored in plaintext but not consumed by anything.

### 4.7 Sessions (legacy; unused by Android) **[code]**

`start / adjust / end` implement the pre-hold "credit limit" model (`available = max_credits - current_hold`, hold = *increase* of `current_hold`). With `current_hold` now meaning *balance*, `start` and `adjust` add arbitrary amounts to a user's wallet. Not referenced by the Android app or by any other module; safe to remove or lock down.

### 4.8 Call-type record **[code]**

Pure side-channel because the Matrix `rtc.notification` event carries no voice/video flag: caller app `POST /v1/calls/type` right before starting a call; receiver app `GET /v1/calls/type` on the ring push. One row per room, overwritten, **no TTL / no call id / no authorisation**; the server returns `updatedAt` so clients can apply their own freshness rule. No money is involved.

### 4.9 Ledger entries written per action (`wallet_transactions`)

| Action | Ledger row(s) | `users.current_hold` | Other rows |
|---|---|---|---|
| `POST /recharge` | `CREDIT / RECHARGE / CREATED / RAZORPAY` (user) | - | - |
| verify or webhook success | same row -> `PAID` (+ payment id [, signature]) | user `+= amount` | referral bonus (4.10) |
| bad signature on verify | same row -> `FAILED` | - | - |
| `payment.failed` webhook | `CREATED` row -> `FAILED` | - | - |
| `initiate` (new hold) | `DEBIT / HOLD / PAID / SYSTEM` (client, amount = hold) | client `-= amount` | `pending_holds` insert |
| `initiate` (re-use) | none | none | hold `isActive = 1` |
| refund approve (full / partial / auto) | `CREDIT / REFUND / PAID / SYSTEM` (client, `toClient`) | client `+= toClient` | request -> approved; hold deleted / reduced |
| refund reject | none | none | request rejected, hold rejected |
| cron settle | `CREDIT / HOLD_SETTLED / PAID / SYSTEM` (consultant) | consultant `+= amount` | hold deleted |
| referral bonus | `BONUS / REFERRAL / PAID / SYSTEM` (referrer, 50) | referrer `+= 50` | referral -> `REWARDED` |
| `/sessions/*`, `/payouts/*` | **none** in `wallet_transactions` (rows in `transactions`) | sessions change it silently | |

### 4.10 Referral bonus **[code]**

After a successful first credit (verify or webhook) the code looks for a `referrals` row with `referred_user_id = user.id AND status = 'PENDING'`; if found it credits the referrer INR 50 (ledger `BONUS/REFERRAL`) and marks the row `REWARDED`. Errors are swallowed (a missing table just logs a warning). Nothing in this API creates referral rows.

---

## 5. Authentication and Matrix provisioning

### 5.1 Credential rules

| Item | Rule |
|---|---|
| Email | `@IsEmail()` (validator.js defaults), <= 255 chars; stored `trim().toLowerCase()`; unique. **Not verified** (no confirmation mail at sign-up). |
| Username (handle) | typed by the user, `^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$` (3-30 chars), lower-cased server-side, no spaces, not UUID-shaped, unique in the Wallet DB **and** free on Synapse. Immutable once provisioned. |
| Password | 8..200 characters, no composition rules, scrypt-hashed. |
| Name | 2..255 chars, mandatory. |
| Role | `isConsultant` 0/1 chosen at sign-up (Google: asked via the `needsRole` handshake). Changeable later with the unauthenticated `PATCH /v1/users`. |

### 5.2 JWT

- Signed by `@nestjs/jwt` with `JWT_SECRET` (HS256). Claims: `{ sub: <users.id UUID>, email, iat, exp }`; no `iss` / `aud` / `jti`. Lifetime `JWT_EXPIRES_IN` (30d locally).
- Sent as `Authorization: Bearer <jwt>` (scheme case-insensitive). Verified by `JwtAuthGuard`, which sets `req.user = {id, email}`. Accepted by exactly two routes: `matrix-session` and `me`.
- No refresh, no revocation, no `tokenVersion`: a stolen JWT can mint Matrix sessions for the whole lifetime, password reset does not kill it, and only deletion of the user row (`Account no longer exists`) does. Android keeps it in memory only and uses it once, immediately after login.

### 5.3 Password hashing and reset codes

- **scrypt**: `N = 16384`, `r = 8`, `p = 1`, 64-byte key, 16-byte random salt, stored `scrypt$N$r$p$saltB64$hashB64`; verification re-derives with the stored parameters and `timingSafeEqual`; an unknown identifier runs the same work against a pre-computed dummy hash.
- **Reset code**: 6 random digits (`crypto.randomInt`), stored only as `HMAC-SHA256(pepper, "<email>:<code>")`, TTL 15 min, 5 attempts (atomic counter), single use, newest code wins. Pepper = `PASSWORD_RESET_SECRET`, else `JWT_SECRET`, else `MATRIX_REGISTRATION_SHARED_SECRET`.
- Throttles are per IP only (no per-account / per-email lockout).

### 5.4 Matrix account creation and session issue

**Create (new account)** - `MatrixService.register()`:
1. `GET /_synapse/admin/v1/register` -> `{nonce}`.
2. `POST /_synapse/admin/v1/register` with `{nonce, username: <localpart>, password: <32-char random alnum>, admin: false, mac}` where `mac = HMAC-SHA1(MATRIX_REGISTRATION_SHARED_SECRET, nonce\0username\0password\0notadmin)` (hex, NUL-separated). This is Synapse's **shared-secret registration** (the homeserver runs `enable_registration=false`). Synapse's response already carries `user_id`, `access_token`, `device_id`; all three must be present or the call fails.
3. Best effort `PUT /_matrix/client/v3/profile/{id}/displayname {displayname: name}`.
- Localpart = the chosen **username**; legacy / fallback = the user's **UUID** (`@<uuid>:clarivahub.com`). The password is never stored or sent to the client. A taken localpart => `ConflictException` tagged "username taken" (a user-chosen handle surfaces as 409; a Google-derived handle silently advances to `name2`, `name3`...).

**Issue a session for an existing account** - `matrixSessionForUserId()` -> `provisionForUser(userId, storedMatrixUserId, name, username)`:
1. Tamper guard: `storedMatrixUserId` must equal `@<uuid>:server` or `@<normalised username>:server`, else `409`.
2. `reissueSession()`: **rotate the Matrix password** with the admin API `PUT /_synapse/admin/v2/users/{id} {password: <new random>, logout_devices: false}` (existing devices stay logged in), then a normal `POST /_matrix/client/v3/login` (`m.login.password`, `initial_device_display_name: "Clariva (<name>)"`, **no `refresh_token` requested**), verify the returned `user_id`, then re-set the display name.
3. For an account that has no stored Matrix ID yet, the registration response itself is returned (single device).

**Therefore, per `POST /v1/auth/matrix-session` call**: a **new device and a new access token** are created every time (new random `device_id`), the account's Matrix password is rotated, and **nothing is ever revoked** - devices and tokens accumulate until the user (or an admin) removes them; deactivation is the only server-side invalidation. The token is a plain Synapse access token (non-expiring unless the homeserver configures `session_lifetime`; no refresh token is requested). Registration also leaves one orphan device per sign-up (its session is discarded). Cost: about 3 sequential Synapse HTTP calls (15 s timeout each), and Synapse's own login rate limits apply (6.9).

**Concurrency**: two simultaneous issues for one user each rotate the password and then log in with *their own* password; the loser gets `M_FORBIDDEN` -> `500 Matrix login failed ...` (race R4). Serialise calls per user client-side.

**`recoveryPassphrase` derivation (scheme only)**: `base64( HMAC-SHA256( key = MATRIX_RECOVERY_SECRET if set else MATRIX_REGISTRATION_SHARED_SECRET, message = "clariva-recovery-v1:" + <the Matrix user id returned by Synapse> ) )`, with the characters `+`, `/`, `=` deleted and the result truncated to 43 characters (so alphanumeric, <= 43 long). Deterministic, never stored, identical for every device and every call. It is the passphrase of the account's Matrix secret storage (4S); a device that has it can unlock cross-signing + key backup and read history without interactive verification. Consequences: (a) the operator can decrypt message history (the code comments say not to market this as E2EE against Clariva); (b) rotating `MATRIX_REGISTRATION_SHARED_SECRET` (while `MATRIX_RECOVERY_SECRET` is unset, as locally) would change every user's passphrase and orphan all existing backups; (c) the passphrase is returned to anyone who can obtain a JWT for the account.

### 5.5 Google ID-token verification

- `google-auth-library` `OAuth2Client.verifyIdToken({idToken, audience: GOOGLE_CLIENT_IDS[]})` -> signature against Google's published keys, `exp`, and `aud` in the allowed list; then explicit `iss` check, `email_verified === true`, `sub` present. Any failure => `401`.
- **Audience**: the *Web/server* OAuth client ID (Android's `GOOGLE_SERVER_CLIENT_ID`, the single value currently configured). An ID token minted by Google Identity Services on a web page has `aud` = the `client_id` passed to GIS; it is accepted iff that value is in `GOOGLE_CLIENT_IDS` (comma-separated list supported).
- Account linking is by **verified, lower-cased email**; `googleId` is stored but never used for lookup; a different `sub` never overwrites an existing one. No `nonce` is checked.
- Role handshake, derived usernames and `mode:'signup'` behaviour: see #7.

### 5.6 Deactivation

`GET reauth-method` (tells the UI whether to ask for a password or a fresh Google token) -> `POST deactivate` (proof in the body, no JWT) -> Synapse admin deactivation (`erase` = Synapse's GDPR-style erase flag, see #9) -> hard delete of the Clariva row. Irreversible; wallet balance and open holds are not settled or refunded; the handle can never be re-registered (Synapse keeps the localpart).

### 5.7 Identity model summary

| Identifier | Where used |
|---|---|
| `users.id` (UUID) | JWT `sub`; legacy Matrix localpart; accepted as `userId` by `wallet/*`; `sessions` |
| `email` / `username` | login (`identifier`); `username` is the Matrix localpart |
| `matrixUserId` | Matrix; `reauth-method`, `deactivate`; equals `Webuddy_name` for Clariva accounts |
| `Webuddy_name` | the wallet key in `/v1/users/:x`, holds, refunds, `wallet/*` |

---

## 6. Browser-client gap analysis (prioritised)

### 6.1 Priority overview

| Pri | Gap | Blocks a web launch? | Where |
|---|---|---|---|
| **P0** | No CORS; pre-flight cannot succeed | **Yes** - nothing works cross-origin | 6.2 |
| **P0** | Rate-limit bucket / client IP when the web adds a proxy hop (same-origin proxy or CDN) | Yes in practice - all web users share one 10-logins-per-15-min bucket | 6.4 |
| **P0** | Synapse `rc_login` applies to every server-side login from the single Wallet-API IP | Likely at any scale (config to verify) | 6.9 |
| **P0 (config only)** | Google OAuth origins / client id, Razorpay domain allow-list + webhook + auto-capture, SMTP, web CSP | Yes | 6.3, 6.5 |
| **P1** | Money-minting and takeover routes are unauthenticated (E1-E9, E15) | Not technically, but must be closed before a public web app advertises the API | 6.7 |
| **P2** | Client traps (numeric strings, ids, status semantics, device growth, TZ) | No - handle in the web client | 6.8 |

### 6.2 CORS, CSP, cookies **[exec][code]**

- **State**: `enableCors`/`cors`/`helmet` appear nowhere in `src/`. Confirmed with the same Express stack: an `OPTIONS` pre-flight (`Origin`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: content-type,authorization`) gets **`200` with `Allow: POST` and no `Access-Control-Allow-*` headers**, so the browser aborts before the real request. Simple GETs are sent but their responses are unreadable (no `Access-Control-Allow-Origin`). Every JSON POST / PATCH and anything carrying `Authorization` needs a pre-flight.
- **Option A - same-origin reverse proxy (recommended for production; there is already a precedent: the `clarivahub` site's PHP proxy, which also keeps the wallet host and any future token server-side)**: add e.g. `location /_clariva/ { proxy_pass https://wallet.dranzo.com/; }` to the web server (Clariva-web's `nginx/conf.d/default.conf` is a plain static server today). No CORS surface, the API origin is invisible to third-party pages, CSP stays `connect-src 'self'`. **Requires** forwarding the real client IP (`X-Forwarded-For`) and raising `trust proxy` (6.4).
- **Option B - enable CORS on the API** (needed anyway for dev / preview origins). In `src/main.ts` before `listen`: `app.enableCors({ origin: <allow-list from env CORS_ORIGINS, never '*'>, methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Authorization','Content-Type'], exposedHeaders: ['Retry-After','X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset'], maxAge: 86400, credentials: false })`. Android sends no `Origin`, so it is unaffected.
- **Cookies / CSRF**: the API sets and reads **no cookies**; auth is a bearer token. Use `fetch(..., {credentials: 'omit'})`; CSRF is not applicable. Keep the Clariva JWT **in memory** (as Android does); Matrix credentials belong in the Matrix SDK's own storage.
- **Web-app CSP** must allow (verify against each vendor's current docs): `connect-src` the wallet origin (or `'self'` with a proxy), `https://matrix.clarivahub.com`, `https://api.razorpay.com`, `https://lumberjack.razorpay.com`, `https://accounts.google.com`; `script-src` `https://checkout.razorpay.com`, `https://accounts.google.com/gsi/client`; `frame-src` `https://api.razorpay.com`, `https://checkout.razorpay.com`, `https://accounts.google.com`; `style-src` for the Google button styles.
- **Caching**: Express adds weak `ETag`s and no `Cache-Control`. Send `cache: 'no-store'` on balance / status / matrix-session calls (server-side `Cache-Control: no-store` on `matrix-session` is a cheap addition, section 7).

### 6.3 Razorpay web checkout compatibility **[code]**

Fully compatible with the current endpoints, no server change required - and already proven by the `clarivahub` recharge page (`recharge.html` loads `https://checkout.razorpay.com/v1/checkout.js`; `wallet.js` opens `new Razorpay({key: order.keyId, order_id: order.orderId, handler, modal:{ondismiss}})` and forwards the three `razorpay_*` fields to `verify`):

| Aspect | Server behaviour | Web implication |
|---|---|---|
| Order | `POST /v1/wallet/recharge` -> `{keyId, orderId, amountInPaise, currency:'INR', transactionId}` | Pass straight into `new Razorpay({key: keyId, order_id: orderId, amount: amountInPaise, currency, name:'Clariva', description:'Wallet Recharge', theme:{color:'#3399cc'}, handler, modal:{ondismiss}})`. The key id comes from the API, so the web bundle needs no Razorpay key and picks up test vs live automatically. |
| Units / currency | rupees in, paise out, INR only | Validate `1 <= amount <= 100000`; prefer whole rupees (fractions can mismatch by a paisa). |
| Signature | `HMAC_SHA256(order_id + "\|" + payment_id, key_secret)` hex | Identical to the Checkout.js `handler` payload (`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`) - forward the three values as-is plus `userId` and `transactionId`. |
| `transactionId` | returned as a **string**; `verify` accepts string or number | Capture it in the `handler` closure (Android keeps an `orderId -> transactionId` map in memory). |
| Idempotency | `verify` and the webhook both credit at most once | Safe to retry `verify`; after a failed/lost `verify` poll `GET /v1/users/{me}` or history - the webhook will have credited. |
| Webhook | `payment.captured`, `payment.failed`; raw-body HMAC | Needed for tab-closed-after-payment cases. Dashboard URL `https://wallet.dranzo.com/v1/wallet/webhook`, same secret. |
| Capture | order created without `payment_capture` | Account-level auto-capture **must** be on or `payment.captured` never fires. |
| Redirect flow | no form-POST `callback_url` endpoint exists | Do not use `redirect: true`; use the modal `handler` flow. |
| Domains | - | Live mode requires the web domain to be allow-listed in the Razorpay dashboard. Local `.env` is **test mode** (`rzp_test_`); production mode is **[unverified]**. |

### 6.4 Rate limits, proxies, capacity **[code]**

- Throttling exists **only** on `AuthController` (limits in 2.1). Everything else (balance, holds, refunds, wallet, calls) is unthrottled. Key = IP; storage = process memory (limits multiply with the number of Node processes and reset on restart).
- `trust proxy = 1`: `req.ip` is the address the **single** trusted proxy saw. Topologies: `browser -> Apache -> Node` is correct. `browser -> nginx(web) -> Apache -> Node` makes `req.ip` the nginx address for **every web user** (10 logins / 15 min and 10 sign-ups / 15 min for the whole web population). A CDN (Cloudflare etc.) in front of `wallet.dranzo.com` has the same effect unless Apache restores the real IP. Make the hop count configurable (section 7, M2) and make the proxy append the client IP.
- NAT / mobile-carrier users share IPs; 10 login attempts per 15 min per IP is tight for real users and weak against distributed attacks (no per-account counter).
- Capacity: mysql2 default pool of 10 against a remote DB; `status` runs 2-3 queries per call (no index serves the refund-notification query). Android already polls at 15 s (status) and 60 s (balance, `exists`, rate); the web must not poll faster and should pause when the tab is hidden. A 5 s poll previously "starved the MySQL pool" (comment in `MessageComposerPresenter`).

### 6.5 Google Sign-In for the web **[code]**

- Backend accepts any ID token whose `aud` is in `GOOGLE_CLIENT_IDS`. Today the list holds a single value, the Android `GOOGLE_SERVER_CLIENT_ID` (a **Web-application** OAuth client). A Google Identity Services button / One Tap on the web page returns an ID token with `aud` = the `client_id` given to GIS.
  - *Simplest*: reuse that same Web client id in GIS and add the web origin(s) to its **Authorized JavaScript origins** in Google Cloud Console - **no backend change**.
  - *Or* create a separate Web client for the Clariva web domain and **append** its id to `GOOGLE_CLIENT_IDS` (comma-separated).
  - An Android-type client id is irrelevant to the web.
- The API checks `iss`, `exp`, `email_verified`, but **no `nonce`** (GIS lets you set one; the API would ignore it).
- Flow parity: `POST /v1/auth/google {idToken}` -> maybe `{needsRole:true,...}` -> ask the role -> repeat with `isConsultant` (and `mode:'signup'` from the sign-up screen) -> `{token, user}` -> `matrix-session`.
- Deactivating a Google account needs a **fresh** ID token for the same email (re-run the GIS prompt), then `POST /v1/auth/deactivate {matrixUserId, googleIdToken, eraseData}`.
- Pre-hijack caveat: finding E15.

### 6.6 What assumes Android **[code]**

- **No header, User-Agent or platform check exists** in the API (the throttler's optional `ignoreUserAgents` is unset; `UserAgentInterceptor` is Android-only). Android sends no `Authorization` on wallet routes and no custom headers at all.
- Protocol assumptions a web client must reproduce: (1) after the Matrix send, call `initiate` (fire-and-forget) and, for calls, only after the callee answers; (2) the composer paywall gate is client-side; (3) 15 s `status` poll, 60 s balance / `exists` / rate refresh, `pending-for-consultant` on list refresh; (4) auto-approval announcements: read `pendingAutoApprovalNotification`, call `auto-approval-claim`, and if `claimed` post the DM message (otherwise the other party is never notified); (5) call-type write before starting / read when joining; (6) the `needsRole` handshake; (7) the JWT is used once to fetch the Matrix session; (8) 404 self-heal through `POST /v1/users` for the user's **own** id only.
- Android's KDoc on `ApproveRefundRequest` ("the consultant keeps the remainder (credited immediately)") is **out of date**: since backend commit `a09f6e01` the remainder stays escrowed until the 24h cron.
- Every Matrix device is labelled `Clariva (<name>)` regardless of platform; Android and web devices cannot be told apart in the device list (nice-to-have N1).

### 6.7 Security observations (exploitable routes and minimal hardening)

"Contract-safe" = Android keeps working unchanged. "Identity binding" needs a caller credential (7, S5). All items verified in code unless noted. The real-money impact of minted *balance* (E1, E2, E3, E4, E5) depends on how consultant earnings are paid out - there is no cash-out API, so that is an offline process today; at minimum the platform loses chat revenue and ledger integrity.

| ID | Sev | Route(s) | What an anonymous caller can do | Minimal hardening | Android impact |
|---|---|---|---|---|---|
| E1 | **Critical** | `POST /v1/sessions/start`, `/adjust`, `/end` | Mint unlimited wallet balance for any user UUID: `start` with `sessionFee: 0` on an account with `max_credits >= current_hold` (every fresh account: 0 >= 0), then `adjust` with `adjustedFee: 99999999` -> `current_hold += difference`, no cap, no ownership check. `end` can push balances negative. (Assumes the legacy `sessions` / `transactions` tables from `init.sql` exist in production - unverified; the code path is otherwise live.) | Remove the module or `@UseGuards(InternalTokenGuard)` on `SessionsController` | None (never called) |
| E2 | **Critical** | `POST /v1/pending-holds/create`, `PATCH`/`DELETE /v1/pending-holds/:id`, `GET /v1/pending-holds/all`, `GET /v1/pending-holds/:id` | Create a hold of any `amount` payable to any `consultandId` (the cron credits it >= 24h later with **no debit anywhere**); edit amounts / parties of real holds; delete escrow rows (client's money vanishes); dump every pair and amount. | `InternalTokenGuard` on those five handlers (or delete them) | None |
| E3 | **Critical** | `POST /v1/wallet/cron/pending-holds/trigger`, `/monthly-payouts/trigger`, `GET /v1/wallet/cron` | Fire several concurrent triggers: each loads the same eligible holds and each credits the consultant again (`settle()` never re-checks the hold inside its transaction) -> N x credit (R1). Run the monthly payout job at will. | Guard with `InternalTokenGuard`; make `settle()` idempotent (7, S3) | None |
| E4 | **Critical** | `PATCH /v1/users/:Webuddy_name` | (a) set `max_credits` **negative** (accepted [exec]) on an account used as the "consultant" in `initiate` -> the payer's balance is *increased* by the absolute value; (b) set a huge `max_credits` on a victim consultant; (c) **rename `Webuddy_name`**, freeing a victim's identity string for another row so holds / settlements keyed by that string follow the new owner; (d) flip `isConsultant`; (e) overwrite `phoneNumber`, `name`, `settings`. | DTO bounds `@Min(0) @Max(99999999)` on `max_credits`; remove `Webuddy_name` and `phoneNumber` from `UpdateUserDto` (Android sends neither); later bind to caller | None (Android sends `max_credits >= 0` integers and `isConsultant` only) |
| E5 | **Critical** | `POST /v1/pending-holds/initiate` | Drain any client: `{clientId: <victim MXID>, consultantId: <attacker account with a high max_credits>}` debits the victim up to their balance and the hold settles to the attacker 24h later; the victim's refund request is answerable by the attacker (E6). Needs only the victim's public Matrix ID. | Identity binding (caller must equal `clientId`). Interim mitigations: per-IP throttle, an upper bound on `max_credits` (e.g. <= business maximum) | Needs the credential header (phase C) |
| E6 | High | `POST /v1/refund/request`, `/approve`, `/reject` | A client requests **and approves** its own refund (the consultant is paid nothing); anyone can reject or approve any request, with any partial amount. | Identity binding: request => caller is the hold's client; approve / reject => caller is the hold's consultant | Phase C |
| E7 | High | `POST /v1/users` | Squat a person's future `Webuddy_name` (their later sign-up dies with `ER_DUP_ENTRY` -> 500 and a burned Synapse localpart); mass-create wallet rows **and Synapse accounts** (`@<uuid>:clarivahub.com`, unthrottled); choose a starting `max_credits`. | Ignore `max_credits` / `settings` / `phoneNumber` in `CreateUserDto`; require auth and `Webuddy_name == caller.matrixUserId`; throttle | Android sends only `name`, `Webuddy_name`, `isConsultant` |
| E8 | High (privacy) | `GET /v1/users/:Webuddy_name` | Read any user's **email, phone, internal UUID, username, `settings`, wallet balance**. (The hub proxy deliberately hides balances from its own page for exactly this reason.) | Whitelist the response to `Webuddy_name, max_credits, isConsultant` (+ `current_hold` only for the caller once identity exists) | Android decodes only `current_hold, max_credits, Webuddy_name, isConsultant`; the hub proxy reads only `isConsultant` |
| E9 | High (privacy) | `GET /v1/wallet/history` | Read any user's full ledger (amounts, timestamps, Razorpay ids) by Matrix ID or UUID. | Identity binding | Phase C |
| E10 | Medium | `POST /v1/wallet/recharge`, `/verify` | `verify` is protected by the Razorpay HMAC (strong). `recharge` lets anyone open Razorpay orders / `CREATED` ledger rows on any account (DB and Razorpay-API spam, unthrottled). Topping up *someone else's* wallet is a deliberate feature of the hub page, and money only moves after a real payment, so the exposure is spam, not theft. | Throttle `recharge`; do **not** bind these two to the caller (the hub proxy would break) - allow either the caller's identity or `X-Internal-Token` | None |
| E11 | High | `GET /v1/experts/:expertId/bank-details`, `POST /v1/experts/bank-details` | Read plaintext account number / IFSC / holder name for any expert id; attach bank details to any expert id. Likely inert in production (Android's POST 404s) - **verify**. | `InternalTokenGuard` on the GET now; encrypt at rest; owner-bind the POST | POST: Phase C |
| E12 | Medium (latent) | `POST /v1/payouts/manual`, `/monthly` | Mock today; becomes an open payout trigger the day a gateway is wired in. | `InternalTokenGuard` | None |
| E13 | Medium / Low | `GET /v1/pending-holds/exists`, `/status`, `GET /v1/refund/pending-for-consultant`, `POST /v1/refund/auto-approval-claim/:id` | Learn who pays whom, hold and refund amounts; claim (and so suppress) any auto-refund announcement. | Identity binding (either party) | Phase C |
| E14 | Low | `POST /v1/calls/type` | Overwrite any room's call type (wrong ringing label). | Optional identity binding | Phase C |
| E15 | **High** (account takeover) | `register` + `google` | **Unverified-email pre-hijack**: the attacker registers `victim@example.com` with their own password (emails are never verified). When the victim later taps "Sign in with Google" the API matches the verified email, links the Google id and signs the victim into the *attacker-credentialed* account; the attacker keeps password login, can mint Matrix sessions and read history (shared recovery passphrase). | On first Google link of an account that has a `passwordHash` and no email-verification proof, clear `passwordHash` (or add `emailVerifiedAt` + a verification mail) | None |
| E16 | Medium | login / forgot / reset | Throttles are per-IP, in-memory, per-process: distributed guessing is feasible; no per-account lockout; a 6-digit code gets 5 guesses but new codes are unlimited (each one mails the victim). | Per-identifier / per-email counters | None |
| E17 | **High** (hygiene) | repo | `migrate.js`, `scratch/check_db_schema.js`, `scratch/create_referrals_table.js` are **tracked, still present in HEAD**, and contain hard-coded DB root credentials for the production MySQL (public IP) (`scratch/*` since `75e66370`, `migrate.js` since `79b4d0fe`, so they are also in history); the app itself connects as root; the local `.env` points at the same remote DB, so developer runs hit production data. Tracked logs / zip (`current_startup*.log`, `final_startup.*`, `fresh_startup.log`, `error_log.txt`, `app.log`, `crash.log`, `error.log`; most since the initial commit) may hold PII or secrets - only `error_log.txt`, `app.log`, `crash.log` and `error.log` were skimmed (no secrets seen); the startup logs and `dev.log` were only pattern-searched for route / column lists, and the 88 MB zip was not opened. **Values are intentionally not reproduced here.** | Rotate the DB password now; least-privilege app user; purge files from history; move boot-time DDL to migrations; separate dev DB | None |
| E18 | Medium | JWT | 30-day, non-revocable, mints unlimited Matrix sessions; not invalidated by password reset; `me` skips the DB check. | Shorter lifetime / `tokenVersion` for web; keep in memory | None |

### 6.8 Behaviours and bugs a second client can trip over

**Races (money-relevant)**

| ID | Race | Effect | Minimal fix |
|---|---|---|---|
| R1 | `settle()` loads holds, then per hold locks the *user* row, credits and deletes the hold, with no `FOR UPDATE`/re-check on the hold; two overlapping `handleCron()` runs (manual triggers, or >1 Node process) both credit | consultant paid N times | single-flight flag + inside the transaction `SELECT ... FROM pending_holds WHERE id=? FOR UPDATE` (skip if gone) or `DELETE` first and continue only if `affectedRows = 1` |
| R2 | `requestRefund` has no row lock | two `requested` rows for one hold | `lock: pessimistic_write` on the hold read |
| R3 | `approveRefund` reads `refund_requests` before taking the hold lock (snapshot read) | two concurrent **partial** approvals both pass the state check and refund twice (auto-approval + manual approve is the realistic case) | re-read the request `FOR UPDATE` after locking the hold |
| R4 | concurrent `matrix-session` calls for one user rotate the Matrix password twice | one call fails `500 Matrix login failed ...: M_FORBIDDEN` | per-user mutex server-side; single-flight client-side |
| R5 | verify vs webhook | **safe** (txn row locked, state re-checked) | - |
| R6 | 24h edge | a message at 24h01m starts a second hold although the first is still waiting (<= 1h) for the cron | by design; document |
| R7 | `initiateHold`: the first statement in the transaction is a *plain* read of the consultant, which opens the InnoDB snapshot (default REPEATABLE READ); the client row is then locked (`FOR UPDATE` sees the latest data) but the "existing hold" lookup is another plain read that uses the **old snapshot** and cannot see a hold committed by a concurrent request [infer from InnoDB semantics; the isolation level in production is unverified] | two quick first sends (the Android composer allows this) can create **two holds and charge twice** | take the client row lock first (reorder two reads) or read the existing hold with `lock: pessimistic_write`; add a unique key / re-check under the lock |

**Idempotency / retry-safety (what happens when a request is repeated, e.g. after a lost response)**

| Route | Retry result |
|---|---|
| `register` | not idempotent: the repeat gets `409 An account with that email already exists` although the first call succeeded - the client should fall back to `login` |
| `login`, `google` | safe (a new JWT each time); `google` with `needsRole` is stateless |
| `matrix-session` | **not idempotent**: every repeat adds a device and rotates the Matrix password (R4) |
| `forgot-password` | safe but each call invalidates the previous code and sends a new mail |
| `reset-password` | single use: the repeat after success is `400 ... invalid or has expired` |
| `deactivate` | repeat after success is `401` (account gone) |
| `POST /v1/users` | idempotent for a known `Webuddy_name` / `matrixUserId`; otherwise creates a row **and a Synapse account** |
| `PATCH /v1/users` | idempotent (set semantics) |
| `recharge` | **not idempotent**: each call is a new order and ledger row; there is no idempotency key, so guard double-clicks client-side |
| `verify`, webhook | idempotent (credit exactly once; repeat returns success) |
| `initiate` | idempotent within a 24h window (re-use), except the concurrent-first-send race R7 |
| `refund/request` | repeat => `400 Refund has already been requested` |
| `refund/approve` | repeat => `400 Refund is not awaiting a decision (current status: approved)` for a partial refund, or `404 Pending hold not found` after a full refund (the hold is gone); treat both as "already done" |
| `refund/reject` | repeatable (no state guard) |
| `auto-approval-claim` | only the first caller gets `claimed: true` |
| `calls/type` | idempotent upsert |
| cron triggers | **unsafe to repeat or overlap** (R1) |

**Client traps**

- **B1 numeric strings**: see the table in 2.9. Always `Number()`; round to 2 dp for display (`newBalance` can carry float noise such as `300.29999999999995`).
- **B2** `verify` can answer with `newBalance` as a string when the webhook already credited (a very common race right after payment); Android declares it as `Double` (tolerance unverified); the money is credited either way, so treat a parse problem as "refresh the balance", not as a payment failure.
- **B3 identifiers**: wallet routes take `Webuddy_name` (or the UUID for `wallet/*`), **not** `matrixUserId`. For Clariva-provisioned accounts the two are equal; legacy rows (and rows healed before `Webuddy_name` existed) may differ. The 404 self-heal is `POST /v1/users {name, Webuddy_name: <own MXID>, isConsultant}`; it is idempotent for a matching `Webuddy_name`/`matrixUserId`, but if nothing matches it creates a **new wallet row and a new Synapse account** - never call it with another person's id or a typo. `initiate` has no heal: `404 Consultant X not found` / `Client X not found`.
- **B4** URL-encode ids in paths (`@`, `:`); case-insensitive MySQL collation but case-sensitive JS comparison - keep Matrix IDs lower-case.
- **B5 status semantics**: `status` omits `isActive` / `isRefundActive` (Android defaults them to 1); `status` is bidirectional, `exists` is directional (payer first); after a reject or a partial refund `exists = true` but `status.exists = false`; `pendingAutoApprovalNotification` can be non-null while `exists = false`.
- **B6** All POSTs succeed with **201** except those with `@HttpCode(200)` (2.0).
- **B7 errors**: `message` is a string **or** an array; `404` for unknown routes also uses the envelope. Oversized bodies (> 100 kB) become `500` under the catch-all filter [infer].
- **B8 history**: bad `page` / `pageSize` => `500`; `pageSize=0` => `totalPages: null`. Page size is unbounded.
- **B9 recharge**: whole rupees recommended; max 100000; each call opens a new order.
- **B10 timezone**: dates are ISO strings built from JS `Date`s. MySQL `DATETIME` columns are written by MySQL in its session time zone and read by `mysql2` in Node's local zone (no `timezone` option is set); JS-side 24h windows (`initiate`, `exists`, cron) are compared with those columns. If Node and MySQL zones differ, windows and timestamps are off by the difference. Verify (`SELECT @@global.time_zone, @@session.time_zone, NOW()` vs. the Node process TZ); recommended end state is both on UTC with `timezone: 'Z'`. Cron jobs also use Node's local zone.
- **B11 matrix-session**: a new device per call (6.9); never call it on page load; one call per login; serialise.
- **B12 sign-up**: `username-available` ignores Synapse - still expect `409` on submit; `register` failure after Synapse success leaves the localpart burned; trim client-side (DTO email validation is not forgiving).
- **B13 deactivation** hard-deletes the wallet row: warn about balance and open holds; usernames cannot be reused.
- **B14 call type** never expires (2.7): apply a freshness window on `updatedAt` client-side.
- **B15** `GET /v1/auth/me` reflects token claims only.
- **B16** Android KDoc on partial refunds is stale (6.6).

### 6.9 Synapse-side constraints that surface through this API

- **Login rate limits (verified in stock Synapse source)**: `rc_login.address` and `rc_login.account` default to `per_second 0.003, burst_count 5`. Every `matrix-session` performs one `m.login.password` login from the **Wallet-API host's single IP** for that one account: after 5 quick logins, about one more every 5.5 minutes, for the entire user base, unless `homeserver.yaml` overrides `rc_login` **[unverified - production homeserver config not available]**. A rejected login surfaces as `500 Matrix login failed for <localpart>: M_LIMIT_EXCEEDED`. This is the most likely first scaling failure when a web client doubles sign-in volume.
- **Device growth**: no cleanup anywhere (6.8 B11); Synapse keeps every device (and its to-device inbox / key-claim load) forever. The web client should persist its session and call Matrix `/logout` on sign-out; a periodic admin clean-up job is a nice-to-have.
- **Token lifetime**: tokens are issued without `refresh_token`; they live until logout / deactivation unless the homeserver sets `session_lifetime` **[unverified]**. After expiry the web must repeat login -> matrix-session.
- **Reachability**: the Wallet-API host must be able to reach `/_synapse/admin/*` on the homeserver (ideally restricted to that host's IP at the reverse proxy).
- **Secret storage bootstrap**: the first device to sign in must create cross-signing + 4S using `recoveryPassphrase`; later devices unlock it. Two clients bootstrapping at the same moment is a client-side coordination problem, and the passphrase must stay stable (never rotate the secrets it derives from).

---

## 7. Recommended minimal backend changes

Size legend: XS < 5 lines, S 5-25, M 25-100, L > 100. "Android" = effect on the existing app.

### 7.1 Required to launch the web client (functional)

| ID | Change | File(s) | Size | Android |
|---|---|---|---|---|
| M1 | **CORS**: `app.enableCors({...})` with an env allow-list (`CORS_ORIGINS`), headers `Authorization, Content-Type`, methods incl. `PATCH, DELETE, OPTIONS`, exposed `Retry-After` / `X-RateLimit-*`. *Skip if the web is served through a same-origin proxy (but still needed for dev origins).* | `src/main.ts` (+ `.env.example`) | S | none |
| M2 | Make `trust proxy` hop count configurable (`Number(process.env.TRUST_PROXY_HOPS ?? 1)`), and have the proxy forward `X-Forwarded-For`. Required for a same-origin proxy or CDN, otherwise all web users share one throttle bucket. | `src/main.ts` | XS | none |
| M3 | **Config only**: add the web Google client id to `GOOGLE_CLIENT_IDS` (or add the web origin to the existing client in GCP); Razorpay dashboard: allow the web domain, confirm webhook URL + events + secret and auto-capture; set `SMTP_*` (password reset) in the production env; confirm `JWT_SECRET`, `MATRIX_ADMIN_TOKEN` present; **pin `MATRIX_RECOVERY_SECRET` to the value currently in effect** before any secret rotation. | production env / dashboards | - | none |
| M4 | **Verify the homeserver's `rc_login`** (or raise it) so server-side logins from the Wallet-API IP are not throttled; document the maximum sign-ins per hour. | Synapse `homeserver.yaml` | - | none |
| M5 | `Cache-Control: no-store` on `matrix-session` (and optionally on wallet GETs) | `auth.controller.ts` (`@Header`) | XS | none |

### 7.2 Security fixes to ship before the web app is public (all contract-safe unless noted)

| ID | Change | File(s) | Size |
|---|---|---|---|
| S1 | `@UseGuards(InternalTokenGuard)` on every route Android never calls: `SessionsController`, `PayoutsController`, `CronController`, `PendingHoldsController` handlers `create / all / :id (GET, PATCH, DELETE)`, `ExpertsController.getBankDetails`. (`InternalTokenGuard` already exists and fails closed; `ConfigModule` is global.) Alternative: delete these routes. Closes E1, E2, E3 (trigger part), E11 (read), E12. | the five controllers | S |
| S2 | Input bounds / minimisation: `max_credits` `@Min(0) @Max(99999999)` in `CreateUserDto` and `UpdateUserDto`; drop `Webuddy_name` and `phoneNumber` from `UpdateUserDto`; drop `max_credits`, `settings`, `phoneNumber` from `CreateUserDto`. Closes the negative-price mint and the identity-rename hijack (E4, E7 partly). | `users/dto/*.ts` | S |
| S3 | Settlement idempotency: single-flight guard in `handleCron()` and, inside `settle()`, lock / re-validate the hold (`FOR UPDATE`, or delete-first and require `affectedRows = 1`) before crediting; same re-validation before the `requested -> auto-approve` path. Closes R1. | `wallet/pending-holds-cron.service.ts` | S |
| S4 | Refund / hold races: `lock: pessimistic_write` when `requestRefund` reads the hold (R2); in `approveRefund` re-read the request `FOR UPDATE` after taking the hold lock (R3); in `rejectRefund` require `refundRequest.status === 'requested'`; in `initiateHold` take the client row lock before the first plain read, or lock the existing-hold read (R7). | `refunds/refunds.service.ts`, `pending-holds/pending-holds.service.ts` | S |
| S5 | **Caller identity for the wallet routes** (closes E5, E6, E8, E9, E10, E13, E14 and the rest of E4/E7). New guard accepting `Authorization: Bearer <Matrix access token>` verified with Synapse `GET /_matrix/client/v3/account/whoami` (cache ~5 min) **or** the Clariva JWT, yielding the caller's `matrixUserId`; apply to `/v1/users*`, `/v1/wallet/{recharge,verify,history}`, `/v1/pending-holds/{initiate,exists,status}`, `/v1/refund/*`, `/v1/calls/type`, `/v1/experts/bank-details` with ownership rules (path / body id must equal the caller; approve / reject only by the hold's consultant; `GET /v1/users/:x` returns the reduced projection for non-owners). **Compatibility constraints**: (i) the `clarivahub` PHP proxy needs `GET /v1/users/:x` (reads `isConsultant`), `POST /v1/wallet/recharge` and `POST /v1/wallet/verify` for *other people's* usernames with no login - so those three must also accept `X-Internal-Token` (the proxy already has an optional hook that sends it; set `WALLET_API_TOKEN` there) and `recharge` / `verify` must **not** be owner-only; (ii) Razorpay's webhook stays HMAC-only. **Roll out in phases** controlled by an env switch `WALLET_AUTH_MODE=off\|log\|enforce`: A) ship S1-S4; B) deploy in `log` mode, web sends the header from day one; C) Android adds an OkHttp interceptor that attaches the session's Matrix access token to `WalletApi` calls (it already holds it; the JWT is memory-only and absent for already-logged-in users, so Matrix-token auth avoids forcing re-login); D) flip to `enforce` once logs show no header-less traffic. | new `common/guards/wallet-auth.guard.ts` (~70 lines) + ~12 one-line decorators; Android interceptor ~15 lines | M (server) + S (Android) |
| S6 | Response minimisation for `GET /v1/users/:x` (whitelist `Webuddy_name, max_credits, isConsultant, current_hold`) even before S5 (drops email, phone, UUID, username, settings, timestamps - Android reads none of them). | `users/users.controller.ts` `toSafeUser` | S |
| S7 | Pre-hijack fix (E15): when `loginWithGoogle` links Google to an account that has a `passwordHash` and no verification proof, null the hash (user can use Google or forgot-password); or add `emailVerifiedAt` + a verification mail. | `auth/auth.service.ts` | S (M with verification mail) |
| S8 | History pagination DTO (`page >= 1`, `1 <= pageSize <= 100`); fixes the 500s and the unbounded dump. | `wallet/wallet.controller.ts` | S |
| S9 | Repo / ops hygiene: rotate the DB password, create a least-privilege DB user, remove `migrate.js`, `scratch/`, tracked logs and `final_startup.zip` from the index **and history**, separate dev from production DB, move boot-time DDL into migrations. | repo / ops | - |
| S10 | Per-identifier throttling for login / forgot / reset (key on the normalised email or username in addition to IP) and a shorter JWT lifetime (or `tokenVersion` bumped by reset-password) for web. | `auth/*` | S-M |

### 7.3 Nice to have

| ID | Change | Notes |
|---|---|---|
| N1 | `matrix-session` accepts an optional body `{ deviceName }` (or header) to label web vs Android devices; per-user single-flight; periodic device clean-up | removes R4 and device clutter |
| N2 | Additive typed fields: `status` returns `isActive`, `isRefundActive`; add `GET /v1/wallet/balance` (numbers) | no break: keep existing shapes |
| N3 | `GET /health` | uptime checks |
| N4 | Index `wallet_transactions(provider_order_id)` and `refund_requests(status, notification_sent, createdAt)`; drop the redundant `idx_users_webuddy_name`; cache `status` or push refund state through Matrix to cut polling | capacity for web polling |
| N5 | Handle `order.paid`; set `payment_capture: 1` explicitly on order creation | independent of account settings |
| N6 | UTC end-to-end (`timezone: 'Z'` in TypeORM options, `time_zone = '+00:00'` on MySQL) | fixes B10 |
| N7 | Replace `error_log.txt` file appends with the logger; map body-parser errors (413) in the filter | log hygiene |
| N8 | Fix the experts flow (resolve the Matrix ID to a user, upsert `experts`, encrypt `accountNumber`) or remove it; remove unused dependencies (`stripe`, `ioredis`, `sqlite3`), `server.js`, stale `api_endpoints.md` / `CPANEL_DEPLOY.md` statements | clean-up |
| N9 | `X-Powered-By` off, security headers | cosmetic |

---

## Appendix A - Web client call sequences (derived from the Android flows)

1. **Email sign-up**: `GET username-available` / `GET email-available` (debounced) -> `POST register` -> `{token,user}` -> `POST matrix-session` (Bearer) -> inject `{userId, accessToken, deviceId}` into the Matrix client, unlock secret storage with `recoveryPassphrase` -> `GET /v1/users/{userId}` (balance, role, own rate; on 404 do the own-id self-heal).
2. **Sign-in**: `POST login {identifier,password}` -> same tail.
3. **Google**: GIS -> `POST google {idToken}` -> if `needsRole` ask -> `POST google {idToken,isConsultant,mode}` -> `{token,user}` -> `matrix-session`.
4. **Recharge**: `POST /v1/wallet/recharge {userId: me, amount}` -> Razorpay modal -> `POST /v1/wallet/verify` -> refresh `GET /v1/users/{me}`; on failure poll balance / history.
5. **Chatting as a client**: on opening a DM `GET exists` + `GET users/{peer}` (rate) + balance; restricted if `!exists && balance < rate`; after each send `POST initiate` (do not block the send); poll `GET status` every 15 s; refresh balance after `initiate`.
6. **Refund**: client `POST refund/request {clientId, consultantId, pendingHoldId (from status)}`; consultant sees `refund_status:'requested'` + `refundRequestId` in `status` and the badge from `pending-for-consultant`; `POST refund/approve {refundRequestId, pendingHoldId, refundAmount?}` or `refund/reject`; unattended -> `pendingAutoApprovalNotification` -> `POST auto-approval-claim/{id} {userId}` -> if `claimed`, post the DM notice.
7. **Calls**: `POST calls/type {roomId, callType, callerId}` just before starting; `GET calls/type?roomId=` when joining (ignore if stale).
8. **Delete account**: `GET reauth-method?matrixUserId=` -> `POST deactivate`.

## Appendix B - `api_endpoints.md` versus the code

| `api_endpoints.md` says | Reality |
|---|---|
| Users keyed by `:id`; create takes `phoneNumber` | keyed by `:Webuddy_name`; create requires `isConsultant`, accepts `Webuddy_name`; phone optional |
| `POST /v1/wallet/recharge {userId, amount, paymentMethod}` | `paymentMethod` is rejected (`forbidNonWhitelisted`); Razorpay only; returns an order, not a payment |
| Missing entirely | `/v1/auth/*` (11 routes), `/v1/wallet/verify`, `/webhook`, `/cron*`, `/v1/pending-holds/*`, `/v1/refund/*`, `/v1/calls/*` |
| Sessions / payouts / experts | accurate shape but legacy and not used by the app; `GET /v1/experts/:expertId/bank-details` expects an `experts.id` UUID |
| `CPANEL_DEPLOY.md`: "synchronize: true" alternative, `npm run typeorm migration:run`, startup `dist/main.js` | `synchronize` is false, there is no migration script; startup file `dist/main.js` is right; `server.js` is stale |

## Appendix C - Open questions and unverifiable items

1. Production process manager and environment (Passenger vs PM2), Node version, number of Node processes (affects R1 and throttling), and whether production uses Razorpay **live** keys and SMTP (local `.env` is test-mode and has no SMTP).
2. Homeserver `homeserver.yaml`: `rc_login`, `session_lifetime`, admin-API reachability from the Wallet-API host.
3. Whether `experts` / `bank_details` / `referrals` rows exist in production; whether `users.isConsultant` allows NULL; live DDL of `wallet_transactions` and `pending_holds` (not in the repo); whether `bank_details` still has its FK.
4. Time zones: MySQL server / session zone versus the Node process zone.
5. Whether `MATRIX_RECOVERY_SECRET` is set in production (locally it is not, so the passphrase depends on the Synapse registration secret).
6. Whether anyone other than the Android app, Razorpay and the `clarivahub` PHP proxy (admin tools, dashboards, cron jobs, other sites) calls the "unused" routes before they are guarded; and whether the production MySQL isolation level is the default REPEATABLE READ (R7).
7. Business decisions: should consultants be able to cash out (no API exists), is the absence of a platform fee intended, should email be verified at sign-up.

## Appendix D - What was executed to verify claims (scratchpad only, no repo files touched)

- `typeorm-undefined-test.js`: SQL rendering in TypeORM 0.2.45 of `where: {Webuddy_name: undefined}` -> `` `Webuddy_name` = ? `` with parameter `null` (matches nothing); `{id: NaN}` -> same. No "first row" behaviour.
- `express-options-test.js`: pre-flight against a plain Express app -> `200`, `Allow: POST`, no `Access-Control-*` headers.
- `dto-validation-test.js`: real DTO classes through `ValidationPipe` with the production options: register / login / recharge / verify / users create+patch / google / reset / initiate messages quoted in section 2; confirmed `max_credits: -50000` is accepted by `UpdateUserDto`, `amount: 10.555` and `"50"` are accepted by `CreateOrderDto`, `paymentMethod` and `current_hold` are rejected as non-whitelisted, `isConsultant: null` passes `GoogleLoginDto`.
- `pipe-object-test.js`: a body typed with an inline object literal (`metatype: Object`) is not validated; a `number`-typed query `abc` becomes `NaN`.
- Source reads of the stock Synapse tree for `rc_login` defaults and the password-login rate limiter; Android `WalletApi`, `WalletService`, `ClarivaAuthApi/Service`, `NetworkModule`, `JsonProvider`, `MessageComposerPresenter`, `MessagesPresenter`, `MessagesFlowNode`, `WalletView`, `BankDetailsPresenter` for client behaviour; `clarivahub/api/*.php` + `wallet.js` + `recharge.html` for the third client.
- Environment facts were obtained by comparing `.env` values to known public constants or by name/length only (RAZORPAY key mode prefix, `DB_USER`, `DB_HOST`/`DB_NAME` equality with the documented values, Google client-id equality with the Android constant); no value was printed or copied.
