# Multi-User Authentication & Per-User Integration Plan

## 1. Mục tiêu

Hiện trạng hệ thống:

- Frontend đã kết nối được Backend.
- Backend đã gọi được Plane API.
- Backend đã gọi được Discord API/MCP.
- Tuy nhiên Plane và Discord hiện đang dùng credential/token/API của một tài khoản cố định.
- Mọi người dùng đi qua hệ thống đều thực thi hành động bằng cùng một danh tính bên Plane/Discord.

Mục tiêu cần cải thiện:

1. Thêm hệ thống đăng nhập cho từng người dùng.
2. Backend xác định chính xác người dùng hiện tại từ session/token.
3. Mỗi người dùng có thể liên kết tài khoản Plane riêng.
4. Mỗi người dùng có thể có cấu hình Discord riêng nếu nghiệp vụ yêu cầu.
5. Plane/Discord credential không còn hard-code hoặc dùng chung một tài khoản.
6. Mọi request đến Plane/Discord phải sử dụng credential thuộc đúng user đang đăng nhập.
7. MCP/Agent không được tự nhận `userId` từ prompt của người dùng như nguồn tin cậy.
8. Phải có authorization để tránh User A đọc hoặc thao tác dữ liệu của User B.
9. Code phải được review lại sau khi hoàn thành implementation.
10. File này phải luôn được cập nhật để phiên Codex khác có thể tiếp tục công việc mà không cần đọc lại toàn bộ lịch sử chat.

---

# 2. Nguyên tắc làm việc bắt buộc cho Codex

## 2.1. Trước khi sửa code

Codex phải:

1. Đọc toàn bộ file này.
2. Đọc phần `CURRENT STATUS`.
3. Đọc phần `LAST SESSION HANDOFF`.
4. Kiểm tra repository hiện tại.
5. Xác định:
   - Frontend framework.
   - Backend framework.
   - Authentication hiện có hay chưa.
   - User model hiện có hay chưa.
   - Plane integration nằm ở đâu.
   - Discord integration nằm ở đâu.
   - MCP client/server nằm ở đâu.
   - Các biến môi trường liên quan.
6. Không được bắt đầu viết code trước khi hiểu luồng hiện tại.

Sau khi inspect repository, cập nhật mục:

`Repository Findings`

trong file này.

---

## 2.2. Không thực hiện tất cả trong một lần

Thực hiện lần lượt theo Phase.

Sau khi hoàn thành một Phase:

1. Chạy test/build phù hợp.
2. Kiểm tra git diff.
3. Cập nhật checklist trong file này.
4. Ghi lại file đã thay đổi.
5. Ghi lại quyết định kiến trúc.
6. Ghi lại lỗi/chưa hoàn thành.
7. Ghi `NEXT ACTION`.
8. Chỉ sau đó mới chuyển sang Phase tiếp theo.

Nếu context sắp đầy:

- DỪNG implementation ở một điểm an toàn.
- Không cố nhồi thêm task.
- Cập nhật `LAST SESSION HANDOFF`.
- Ghi chính xác phần nào đã xong và phần nào chưa.
- Ghi lệnh cần chạy tiếp.
- Ghi các file quan trọng cần đọc ở phiên sau.

Mục tiêu là một Codex session mới chỉ cần:

1. Đọc file này.
2. Xem git status/diff.
3. Tiếp tục từ `NEXT ACTION`.

---

# 3. Kiến trúc mục tiêu

Luồng mong muốn:

```text
User
  |
  v
Frontend
  |
  | Login / Session / Access Token
  v
Backend
  |
  |-- Verify authenticated user
  |
  |-- Resolve internal userId
  |
  |-- Integration Service
        |
        |-- Load Plane credentials for current user
        |
        |-- Load Discord configuration for current user
        |
        v
      MCP / API Client
        |
        |-- Plane API
        |
        `-- Discord API
```

---

# PHASE 5.5 — User Login Flow (2026-09-23)

## CURRENT STATUS

```text
PHASE 0 — Repository Audit: DONE
PHASE 1 — Authentication: DONE
PHASE 2 — User Integration Model: DONE
PHASE 3 — Plane Account Linking: DONE
PHASE 4 — Plane Per-User Context: DONE
PHASE 5 — Discord Integration Strategy: DONE
PHASE 5.5 — User Login Flow: IMPLEMENTED; manual two-user smoke test pending
PHASE 6 — Integration Settings UI: NOT STARTED
```

## Repository Findings

LibreChat is the existing identity provider and authentication authority. Its
local email/password route is `POST /api/auth/login`; Google OAuth is available
through `GET /api/auth/google` when `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are configured. Login/OAuth establish LibreChat's
`refreshToken` HttpOnly cookie and return/redirect with a short-lived access
token. Logout is `POST /api/auth/logout`, and refresh is `POST /api/auth/refresh`.

The custom frontend and backend are separate development origins (Vite on
`localhost:3090`, Node on `127.0.0.1:3091`, with LibreChat on `127.0.0.1:3080`),
but the browser uses the Vite `/api` proxy and the backend forwards auth
requests. Credentialed CORS is already enabled and the frontend sends
`credentials: include`. Production must use one configured HTTPS site/domain
or explicitly aligned cookie/CORS settings.

## Architecture Decisions

ADR-009: Reuse LibreChat authentication directly. The custom frontend owns no
user database, does not mint identities, and does not accept a frontend user
ID. The backend's `/api/me` response is derived exclusively from the verified
LibreChat session and preserves the invariant `verified session -> req.user.id
-> user integrations`.

ADR-010: Keep the access token in frontend module memory only. The refresh token
remains an HttpOnly LibreChat cookie; no session token is written to local or
session storage and no token is placed in a URL.

## COMPLETED

- Added a functional project login screen with LibreChat email/password login
  and a Google OAuth entry point.
- Added loading/authenticated/unauthenticated frontend auth state and protected
  the custom chat route behind it.
- Added `GET /api/me` with a safe `{ authenticated, user }` response.
- Added unauthenticated forwarding for LibreChat auth, refresh, OAuth, and
  logout routes while keeping all application/API routes protected.
- Added server-side logout and in-memory frontend credential clearing.
- Added safe-profile auth test coverage and retained existing two-user
  ownership tests.

## FILES CHANGED

```text
be/src/auth.js
be/src/server.js
be/test/auth.test.js
fe/src/App.jsx
fe/src/project-auth.jsx
fe/src/project-auth.css
fe/src/components/ProjectStandaloneApp.jsx
fe/src/components/ProjectChat/AvatarMenu.jsx
fe/src/components/ProjectChat/NavigationRail.jsx
MULTI_USER_INTEGRATION_PLAN.md
```

## TESTS RUN

```text
npm test (be) -> PASS, 19 tests, 0 failures
node --check src/auth.js; node --check src/server.js -> PASS
npm run build (fe) -> PASS
npm run typecheck (fe) -> BLOCKED by pre-existing repository errors in test aliases,
LibreChat markdown dependency types, and unrelated existing components; no new
project-auth error was reported.
git diff --check -> PASS
```

## SECURITY FINDINGS

- No frontend-generated user ID, unsigned identity cookie, localStorage session
  token, Google token logging, auth token URL, or wildcard credentialed CORS was
  added.
- LibreChat's `refreshToken` remains HttpOnly; its existing `Secure` and
  `SameSite=strict` behavior must be retained in deployment.
- Manual browser verification is still required for actual cookie/domain
  behavior and two distinct Google accounts.
- Existing SEC-003/SEC-005 and other integration authorization findings remain
  tracked; this phase did not alter Plane/Discord identity architecture.

## ISSUES / BLOCKERS

- Google login requires LibreChat Google OAuth environment configuration and a
  callback/client domain matching the custom frontend deployment.
- No automated Google OAuth test was attempted; mocked login/session tests are
  covered at the backend boundary.
- The required manual User A/User B smoke test has not been run in this session.

## LAST SESSION HANDOFF

```text
Date: 2026-09-23
Current Phase: Phase 5.5 implemented; manual checkpoint pending.
Completed: Reused LibreChat email/password and Google auth, added project auth
bootstrap/login/logout, `/api/me`, credentialed request wrapper, and tests.
Important files: be/src/auth.js, be/src/server.js, fe/src/project-auth.jsx,
fe/src/App.jsx, fe/src/components/ProjectStandaloneApp.jsx.
Tests: backend 19 passed; backend syntax passed; frontend build passed;
frontend typecheck remains blocked by pre-existing errors.
Do not redo: Phases 0-5 or integration identity architecture.
NEXT ACTION: Perform a manual two-user authentication smoke test. Then start
Phase 6 — Integration Settings UI.

---

## AUTHORITATIVE CHECKPOINT — PHASE 6 (2026-09-23)

Phase 6 Integration Settings UI has been started and the first implementation
slice is complete. The authenticated project UI now has a Settings entry with
safe status and management flows for the existing per-user Plane and Discord
integration endpoints.

COMPLETED:
- Added authenticated Integration Settings UI for Plane and Discord.
- Added Plane connect, replace, and disconnect flows using a password input;
  the Plane token is never rendered back and is cleared after submission.
- Added Discord guild/channel connect, replace, and disconnect flows.
- Displayed only safe integration metadata and backend validation errors.
- Kept identity authoritative on the backend; no frontend userId is accepted or
  sent, and no MCP trust or ownership architecture was changed.
- Corrected the stale `/api/chat/profile` comment to reflect project-owned auth.

VERIFICATION:
- Backend test suite: PASS (19/19).
- Frontend production build: PASS; existing dependency warnings only.
- `git diff --check`: PASS.

CURRENT STATUS:
PHASE 5.5 — IN PROGRESS (manual Google/two-user browser smoke test pending)
PHASE 6 — IMPLEMENTED FIRST SLICE; authenticated browser smoke test pending

NEXT ACTION:
Log in as two separate project users, open Settings, and verify each user can
connect, replace, inspect safe status for, and disconnect only their own Plane
and Discord integrations. Do not start Phase 7 or change the ownership/MCP
trust architecture.

## PHASE 6 VERIFICATION CHECKPOINT (2026-09-23)

Automated Phase 6 isolation and ownership audit: PASS.

- Backend tests: 19/19 passed.
- Separate per-user Plane and Discord records: covered and passed.
- Safe integration responses omit access and refresh credentials: passed.
- Request-supplied `userId` cannot replace the authenticated owner: passed.
- MCP Plane credentials and Discord destinations resolve from authenticated
  execution context: passed, including concurrent-user coverage.
- Frontend integration UI contains no localStorage/sessionStorage credential
  writes; Plane input is cleared after successful submission.
- Frontend production build: PASS (previous Phase 6 build verification).
- `git diff --check`: PASS.

Manual browser/provider verification completed successfully for two Google
accounts, real Plane/Discord connections, browser storage/network inspection,
logout/session switching, and live MCP operations.

FINAL STATUS:
PHASE 6 — COMPLETE

Evidence:
- Backend tests: 19/19 PASS.
- User isolation: PASS.
- Credential replacement isolation: PASS.
- Disconnect isolation: PASS.
- `userId` tampering protection: PASS.
- Per-user MCP ownership: PASS.
- Secret leakage checks: PASS.
- Two-user browser E2E: PASS.
- Session persistence/switching: PASS.
- Frontend production build: PASS.
- `git diff --check`: PASS.

Phase 7 remains deferred until explicitly started.

---

## PHASE 6.5 — PostgreSQL Persistence Migration (2026-09-23)

STATUS: IMPLEMENTED; live PostgreSQL verification pending local database availability.

Completed:
- Added PostgreSQL pool, parameterized query boundary, transactions, error-safe
  pool logging, and graceful shutdown.
- Added schema for users, sessions, integrations, and conversations with foreign
  keys, uniqueness constraints, encryption-at-rest JSONB storage, and indexes.
- Replaced production auth, session, integration, and conversation persistence
  with repository-backed PostgreSQL services.
- Preserved opaque hashed HttpOnly sessions, authenticated `req.user.id`,
  server-side integration encryption, safe integration responses, and trusted
  per-user MCP credential resolution.
- Added idempotent `npm run db:migrate-json` migration for `data/auth.json` and
  optional `data/user_integrations.json`; source JSON files are preserved as
  backups and are not read by the production server after cutover.
- Added PostgreSQL environment documentation, Docker Compose persistent volume,
  and backend container definition.
- Added opt-in real PostgreSQL repository isolation tests.

Verification:
- Existing backend suite: 19 passed, 1 PostgreSQL test skipped because no
  `TEST_DATABASE_URL`/`DATABASE_URL` was configured.
- Node syntax checks: PASS.
- Frontend production build: PASS.
- `git diff --check`: PASS.
- Attempted `docker compose up -d postgres`; Docker Desktop Linux engine was
  unavailable in the environment, so live PostgreSQL execution remains pending.

NEXT ACTION:
Start Docker Desktop or provide `TEST_DATABASE_URL`, run
`npm test` with the database configured, then run `npm run db:migrate-json` and
verify the migrated data before marking Phase 6.5 complete. Do not start Phase 7.

Configuration follow-up: migration initially surfaced a low-level SCRAM error
when no DB password was configured. `database.js` now validates this before
connecting and reports: `PostgreSQL password is missing; set DB_PASSWORD or
DATABASE_URL`. No credentials were added to the repository.

Migration follow-up: legacy conversations may contain pre-auth hash owners or
no owner at all. The migration now preserves these records with nullable
`owner_id` and `legacy_owner_id` instead of binding them to an invalid UUID or
silently deleting them. Only records mapped to authenticated application users
are returned by the production history repository.

---

## ARCHITECTURE CORRECTION — PHASE 5.5 REMAINS IN PROGRESS (2026-09-23)

The prior Phase 5.5 implementation incorrectly made the custom application
depend on LibreChat authentication. That implementation has been replaced.

ADR-011 — Application authentication is independent from LibreChat

Decision:
The project backend owns authentication. Google is the external identity
provider. LibreChat is not part of the authentication trust boundary.

Trusted identity:
Verified project session → `req.user.id`.

Impact:
Plane and Discord ownership remains unchanged. The existing flow continues as
`req.user.id → IntegrationService → per-user Plane/Discord context`.

Current implementation:

- `be/src/applicationAuth.js` stores application users and hashed opaque
  sessions in `be/data/auth.json` using the existing JSON persistence style.
- `be/src/googleAuth.js` performs Google authorization-code/OIDC state/nonce
  handling and provider-side token verification.
- `be/src/auth.js` verifies only the project HttpOnly `project_session` cookie.
- `GET /api/me`, refresh, logout, and all protected routes use the project
  session; LibreChat auth proxy routes were removed.
- LibreChat remains optional non-auth model/UI integration only. The project
  session is never forwarded to LibreChat; only the separately configured
  backend service credential may be used for LibreChat proxy calls.

Development auth callback uses the frontend origin (`localhost:3090`) so the
Vite proxy and browser cookie host remain aligned. Production must set
`PROJECT_FRONTEND_URL`, `AUTH_CALLBACK_URL`, and `AUTH_COOKIE_SECURE=true` for
the deployed HTTPS origin.

Integration migration:
No `be/data/user_integrations.json` exists in the current development data,
so no prior integration ownership mapping requires migration. If such a file is
introduced before manual testing, application user IDs must not be guessed or
silently remapped; use an explicit operator migration.

Tests after correction:

```text
npm test (be) -> PASS, 19 tests, 0 failures
node --check src/auth.js src/applicationAuth.js src/googleAuth.js src/server.js -> PASS
npm run build (fe) -> PASS
```

Phase 5.5 remains IN PROGRESS until the user manually verifies Google login,
refresh persistence, logout invalidation, and two separate browser profiles.

NEXT ACTION: Start the frontend and backend without requiring LibreChat, verify
unauthenticated `/api/me` returns 401, then run the manual two-profile Google
authentication smoke test. Do not start Phase 6 yet.

## AUTH CONFIGURATION CHECK (2026-09-23)

`GET /api/auth/google` correctly reaches the project-owned handler but returns
503 with `AUTH_CONFIG_MISSING` when either `GOOGLE_CLIENT_ID` or
`GOOGLE_CLIENT_SECRET` is unset. The local `be/.env` currently does not define
those Google credentials. No real secret values were logged or added.

Defaults remain aligned with `be/.env.example`:

```text
AUTH_CALLBACK_URL=http://localhost:3090/api/auth/google/callback
PROJECT_FRONTEND_URL=http://localhost:3090
successful redirect=http://localhost:3090/chat/new
```

NEXT ACTION: Configure the project-owned Google OAuth client ID and secret in
the backend environment, register the exact callback URI with Google, restart
the backend, and verify the endpoint returns 302. Do not start Phase 6.
```

## NEXT ACTION

Perform a manual two-user authentication smoke test.

Then start Phase 6 — Integration Settings UI.

Không được dùng luồng:

```text
Prompt
  |
  | "userId = 123"
  v
Agent
  |
  v
Plane API
```

`userId` hoặc identity dùng để lấy credential phải đến từ backend authentication context.

---

# 4. Data model đề xuất

Có thể điều chỉnh theo database hiện tại.

## users

```text
id
email
name
avatar_url
auth_provider
provider_user_id
created_at
updated_at
```

Ví dụ:

```text
auth_provider = google
provider_user_id = Google sub
```

---

# Phase 2 completion update (2026-09-23)

## CURRENT STATUS

```text
PHASE 0 - Repository Audit: DONE
PHASE 1 - Authentication: DONE
PHASE 2 - User Integration Model: DONE
PHASE 3 - Plane Account Linking: NOT STARTED
PHASE 4 - Plane Per-User Context: NOT STARTED
PHASE 5 - Discord Integration Strategy: NOT STARTED
```

## COMPLETED

- Reused the existing Node.js JSON-file persistence architecture; no second database technology was introduced.
- Added a versioned `be/data/user_integrations.json` store with one record per `(userId, provider)`.
- Added `IntegrationService` for get, save/upsert, disconnect, existence, and safe-public lookup operations.
- Integration ownership is always supplied by verified `req.user.id` at the HTTP boundary; request body/query/LLM user IDs are ignored.
- Added `plane` and `discord` provider support without changing either MCP server's runtime credential behavior.
- Added AES-256-GCM encryption for access and refresh tokens using `INTEGRATION_ENCRYPTION_KEY`.
- Added authenticated integration status, connect/save, and disconnect endpoints. Responses contain safe metadata only.
- Added validation preventing token-like values from being stored in provider metadata.

## FILES CHANGED

```text
be/src/integrationService.js
be/src/server.js
be/src/config.js
be/.env.example
be/test/integration.test.js
MULTI_USER_INTEGRATION_PLAN.md
```

## TESTS RUN

```text
npm test -> PASS (8 tests, 0 failures; outside sandbox because Node path resolution is EPERM in the sandbox)
```

Focused coverage includes two-user Plane isolation, provider scoping, current-user-only disconnect, encrypted-at-rest values, safe responses, and metadata secret-smuggling rejection. Existing Phase 1 auth/ownership tests remain passing.

## SECURITY FINDINGS

- SEC-002 remains open: PlaneMCPServer still loads one singleton `PlaneAPIKey` from User Secrets/environment. Phase 2 only provides storage; Phase 3/4 must link and consume per-user Plane credentials.
- SEC-003 remains open: Discord remains a shared bot/channel model and its MCP access/destination authorization is not yet hardened.
- SEC-005 remains open: MCP calls still lack trusted authenticated context propagation.
- No plaintext access/refresh token is written by `IntegrationService`; the JSON store contains encrypted envelopes only. The encryption key is environment-only and is absent from `.env.example`.

## Architecture Decisions

ADR-004
Decision:
Use the existing JSON persistence convention with a versioned `user_integrations.json` document rather than introduce a database or ORM in Phase 2.

Reason:
The project has no database, model, repository, or migration framework. A second persistence technology would add operational complexity before it is needed.

Impact:
The store has an explicit schema version and unique `(userId, provider)` upsert behavior. A future database migration can import this stable shape if scale requires it.

ADR-005
Decision:
Protect access and refresh tokens with Node's standard-library AES-256-GCM using a 32-byte environment key.

Reason:
The project had no encryption utility, and authenticated encryption is available in the platform standard library without adding a dependency.

Impact:
Operators must set `INTEGRATION_ENCRYPTION_KEY` to a 64-character hexadecimal value before saving credentials. Tokens are decrypted only inside the backend service and are excluded from safe API responses.

## ISSUES / BLOCKERS

- Phase 2 has no database migration because no database exists; the versioned JSON schema is the persistence migration boundary.
- `INTEGRATION_ENCRYPTION_KEY` must be configured in deployment before account linking can be implemented.
- Plane authentication type and account-linking flow are still unconfirmed.

## LAST SESSION HANDOFF

```text
Date: 2026-09-23

Current Phase: Phase 2 complete; ready for Phase 3.

Last completed task: Implemented and tested user-scoped integration persistence with encrypted credentials and authenticated safe integration endpoints.

Current implementation state: be/src/integrationService.js stores versioned records keyed by verified LibreChat user ID and provider. be/src/server.js exposes authenticated integration status/save/disconnect routes. Plane and Discord MCP runtime code was not changed.

Files that matter: be/src/integrationService.js, be/src/server.js, be/src/config.js, be/.env.example, be/test/integration.test.js, PlaneMCPServer/Program.cs.

Commands already run: npm test (sandbox blocked before test discovery); npm test with escalation (pass, 8 tests).

Tests status: 8 passed, 0 failed.

Known issues: SEC-002, SEC-003, and SEC-005 remain open. Existing generated .NET artifacts and conversation data changes were preserved.

Important architecture decisions: verified req.user.id is the only ownership key; JSON persistence is reused; credentials use AES-256-GCM; Discord remains shared bot plus authorized mapping.

DO NOT redo: Phase 0 audit, Phase 1 auth, or Phase 2 integration persistence/tests.

NEXT ACTION: Start Phase 3: inspect the exact Plane authentication mechanism and implement account linking/credential registration for the authenticated user.

Recommended first command for next session: Get-Content -Raw MULTI_USER_INTEGRATION_PLAN.md; git status --short; Get-Content PlaneMCPServer/Program.cs; rg -n "PlaneAPIKey|Authorization|Bearer|token|OAuth" PlaneMCPServer be/src
```

# Phase 3 completion update (2026-09-23)

## CURRENT STATUS

```text
PHASE 0 - Repository Audit: DONE
PHASE 1 - Authentication: DONE
PHASE 2 - User Integration Model: DONE
PHASE 3 - Plane Account Linking: DONE
PHASE 4 - Plane Per-User Context: NOT STARTED
PHASE 5 - Discord Integration Strategy: NOT STARTED
```

## Repository Findings

```text
Plane authentication is a personal API key/PAT, not the current OAuth flow.
PlaneMCPServer/Program.cs loads PlaneAPIKey from .NET User Secrets/environment,
loads BaseUrl, Workspace, and ProjectId from appsettings.json/User Secrets, and
registers one singleton PlaneAPIServices instance.

PlaneMCPServer/PlaneAPIServices.cs sends the credential in X-API-Key on every
Plane request. It does not generate Authorization: Bearer headers. Calls use
BaseUrl plus the globally configured Workspace and ProjectId.

The Node backend does not call Plane directly during normal MCP execution;
be/src/mcpClient.js calls the local Plane MCP endpoint configured through
MCP_SERVERS_JSON. Phase 3 adds a separate direct validation call from the
authenticated Node backend to GET /api/v1/users/me/ before persistence.

The current global workspace/project remain in PlaneMCPServer/appsettings.json:
Workspace=maybaymcp and ProjectId=ad10944b-d1d3-44e7-9c35-c6592fe78c77.
They remain runtime configuration until Phase 4 refactors execution.
```

## Architecture Decisions

ADR-006
Decision:
Link Plane accounts with personal API keys/PATs using the Plane `X-API-Key` header.

Reason:
The current project integration uses `PlaneAPIKey` and `X-API-Key` in
PlaneMCPServer/PlaneAPIServices.cs. No OAuth flow is implemented in this
repository; Plane documents OAuth as a separate option, but introducing it now
would not match the deployed integration.

Impact:
An authenticated project user submits a Plane personal API key to the backend.
The backend validates it against the trusted `PLANE_BASE_URL` `/api/v1/users/me/`
endpoint, stores only the encrypted credential and safe external identity, and
never returns the key. MCP execution still uses the singleton credential until
Phase 4.

## COMPLETED

- Added `validatePlaneCredential()` with safe handling for missing, unauthorized, forbidden, unavailable, malformed, and non-success Plane responses.
- Added authenticated `GET /api/integrations/plane`, `POST /api/integrations/plane/connect`, and `DELETE /api/integrations/plane` routes.
- Connect uses only `req.user.id` as the integration owner and ignores any body `userId`.
- Plane credentials are validated before `IntegrationService.saveIntegration()` is called.
- The generic Phase 2 Plane PUT path now rejects direct unvalidated Plane storage.
- The Plane API origin is trusted backend configuration (`PLANE_BASE_URL`); clients cannot supply a Plane URL.

## FILES CHANGED

```text
be/src/planeLinking.js
be/src/server.js
be/src/config.js
be/.env.example
be/test/planeLinking.test.js
MULTI_USER_INTEGRATION_PLAN.md
```

## TESTS RUN

```text
npm test -> PASS (12 tests, 0 failures; outside sandbox because Node path resolution is EPERM in the sandbox)
git diff --check -> PASS
```

Plane tests mock the validation request and cover X-API-Key use, User A/User B
isolation, invalid credentials not being persisted, unavailable/malformed
responses, safe error messages, HTTPS/trusted-origin enforcement, and encrypted
storage without token leakage.

## SECURITY FINDINGS

- SEC-002 updated: Phase 3 linking/validation is complete, but the Plane MCP server still has a singleton `PlaneAPIKey` and global workspace/project. Per-user runtime use remains open for Phase 4.
- SEC-003 remains open: Discord shared bot access/destination authorization is not yet hardened.
- SEC-005 remains open: MCP calls still lack trusted authenticated context propagation.
- No token logging, raw Authorization header exposure, client-controlled Plane URL, or plaintext Plane credential persistence was added.
- Plane validation errors deliberately omit upstream response bodies because they may contain sensitive details.

## ISSUES / BLOCKERS

- Plane account linking validates identity through `/api/v1/users/me/`; workspace/project access remains the existing global MCP configuration and must be made user-scoped in Phase 4.
- `INTEGRATION_ENCRYPTION_KEY` remains required in deployment before linking can persist credentials.
- Existing generated .NET artifacts and conversation data changes are unrelated pre-existing worktree changes and were preserved.

## LAST SESSION HANDOFF

```text
Date: 2026-09-23

Current Phase: Phase 3 complete; ready for Phase 4.

Last completed task: Determined Plane uses personal API keys in X-API-Key and implemented validated, authenticated Plane account linking.

Current implementation state: POST /api/integrations/plane/connect validates the submitted key against the trusted configured Plane origin, then encrypts and stores it for req.user.id. GET and DELETE are user-scoped and safe. Plane MCP execution remains singleton by design until Phase 4.

Files that matter: be/src/planeLinking.js, be/src/integrationService.js, be/src/server.js, be/src/config.js, PlaneMCPServer/Program.cs, PlaneMCPServer/PlaneAPIServices.cs, PlaneMCPServer/appsettings.json.

Commands already run: repository inspection; official Plane API documentation lookup; npm test with escalation; git diff --check.

Tests status: 12 passed, 0 failed.

Known issues: SEC-002 runtime singleton, SEC-003, and SEC-005 remain open. Do not modify generated artifacts or conversation data unrelated to Phase 4.

Important architecture decisions: Plane linking uses personal API key validation via X-API-Key; Plane base URL is trusted server configuration; verified req.user.id is the only owner; OAuth was not introduced.

DO NOT redo: Phase 0-3 audit, authentication, persistence, or Plane linking tests.

NEXT ACTION: Start Phase 4: refactor Plane API/MCP execution so each request uses the authenticated user's stored Plane integration instead of the singleton Plane credential.

Recommended first command for next session: Get-Content -Raw MULTI_USER_INTEGRATION_PLAN.md; Get-Content be/src/mcpClient.js; Get-Content be/src/toolRegistry.js; Get-Content PlaneMCPServer/Program.cs; Get-Content PlaneMCPServer/PlaneAPIServices.cs
```

# Phase 4 completion update (2026-09-23)

## CURRENT STATUS

```text
PHASE 0 - Repository Audit: DONE
PHASE 1 - Authentication: DONE
PHASE 2 - User Integration Model: DONE
PHASE 3 - Plane Account Linking: DONE
PHASE 4 - Plane Per-User Context: DONE
PHASE 5 - Discord Integration Strategy: NOT STARTED
```

## Repository Findings

```text
The frontend calls the Node Express backend. The backend verifies the LibreChat
session and has req.user.id during POST /api/chat. AgentService sends model tool
calls to ToolRegistry; before Phase 4, ToolRegistry called the shared custom
McpClient without any authenticated context. McpClient uses Streamable HTTP
POST requests to the configured /mcp endpoint and maintains a shared MCP session.

The Plane MCP process is a shared ASP.NET Core HTTP process on port 3003. Its
MapMcp("/mcp") endpoint resolves PlaneTools, which receive a singleton
PlaneAPIServices instance. Before Phase 4 that singleton contained one global
PlaneAPIKey. PlaneAPIServices sent it as X-API-Key and used global BaseUrl,
Workspace, and ProjectId.

Phase 4 keeps the shared process and stateless singleton service, but removes
the user credential from its constructor. Node resolves the authenticated
user's encrypted integration per tool call and injects X-Plane-API-Key plus
X-MCP-User-Id only on the internal tools/call request. The .NET MCP endpoint
requires X-MCP-Internal-Token before dispatching any MCP request.
```

## Architecture Decisions

ADR-007
Decision:
Use Pattern A: Node owns integration storage and resolves the Plane credential
per authenticated tool execution, then passes it over a trusted internal MCP
request header. Do not duplicate JSON encryption/storage in .NET.

Trust boundary:
Only the verified Node request context supplies `userId`. The LLM controls
functional tool arguments only. Node creates `X-MCP-User-Id` and
`X-Plane-API-Key` after resolving `(req.user.id, plane)`; neither header is
model-generated. The shared `MCP_INTERNAL_TOKEN` protects the .NET MCP boundary.

Concurrency:
There is no mutable current-user field. Each AgentService/ToolRegistry
execution carries an immutable `{ userId }` context and each call resolves its
own integration. The .NET singleton uses IHttpContextAccessor only to read the
current request headers and stores no per-user state.

Alternatives considered:
Having .NET independently parse/decrypt user_integrations.json was rejected to
avoid duplicated encryption, locking, and schema logic. A global current-user
singleton was rejected as unsafe under concurrent requests.

ADR-008
Decision:
Keep Workspace and ProjectId as application-wide trusted configuration for the
current deployment; only the Plane credential becomes user-scoped in Phase 4.

Reason:
PlaneMCPServer/appsettings.json defines one `Workspace` and one `ProjectId`,
and every existing tool URL is built from those values. Phase 4 does not invent
user-selectable project authorization. Supporting multiple workspaces/projects
requires a later validated selection model.

Impact:
All linked users operate against the configured Plane workspace/project, while
Plane account credentials are isolated per user. LLM-provided project/user
identity cannot change the configured URL scope.
```

## COMPLETED

- Added backend execution-context propagation from `req.user.id` through AgentService and ToolRegistry.
- Added per-call Plane integration resolution and safe `PLANE_NOT_CONNECTED` failure without global-token fallback.
- Added internal MCP authentication with `MCP_INTERNAL_TOKEN`.
- Added per-call `X-Plane-API-Key` and `X-MCP-User-Id` headers outside LLM tool arguments.
- Refactored `PlaneAPIServices` to remove the global Plane API key and read only request-scoped context through `IHttpContextAccessor`.
- Retained `PlaneAPIServices` as a singleton because it is now stateless with immutable app configuration and shared `HttpClient`.
- Kept Plane workspace/project configuration global and documented the limitation.

## FILES CHANGED

```text
be/src/config.js
be/.env.example
be/src/mcpClient.js
be/src/toolRegistry.js
be/src/agentService.js
be/src/server.js
be/test/mcpContext.test.js
PlaneMCPServer/Program.cs
PlaneMCPServer/PlaneAPIServices.cs
MULTI_USER_INTEGRATION_PLAN.md
```

## TESTS RUN

```text
npm test -> PASS (14 tests, 0 failures; outside sandbox because Node path resolution is EPERM in the sandbox)
dotnet build --no-restore -p:OutputPath=tmp-phase4-build\ -> PASS (0 warnings, 0 errors)
git diff --check -> PASS
```

The normal .NET output build was also attempted but could not replace the
already-running `bin/Debug/net10.0/PlaneMCPServer.exe`; the isolated output
build compiled the changed server successfully.

Focused tests cover concurrent User A/User B key isolation, model-supplied
`userId` not changing the trusted key, and missing integration failure without
MCP invocation or fallback.

## SECURITY FINDINGS

- SEC-002 resolved for normal Plane MCP execution: no global `PlaneAPIKey` is loaded or used by `PlaneAPIServices`; missing user integration fails closed. Legacy Plane User Secret `PlaneAPIKey` may still exist locally but is no longer consumed by the normal runtime.
- SEC-005 Plane portion resolved: verified Node identity reaches MCP through server-injected context, cannot be selected by the LLM, and concurrent isolation is tested. SEC-005 remains globally open for Discord until its context is hardened.
- SEC-003 remains open: Discord MCP authorization/destination isolation is not changed in Phase 4.
- Plane API keys never enter prompts, Gemini tool schemas, model arguments, conversation history, MCP tool results, or logs. The per-call key exists only in backend memory and the internal request header.

## ISSUES / BLOCKERS

- `MCP_INTERNAL_TOKEN` must be configured identically in the Node backend and Plane MCP server. Without it, Plane MCP calls fail closed.
- MCP transport should use a protected local network or HTTPS when Node and the MCP server are not co-located; the internal token is the application boundary credential.
- Workspace/project scope remains global by design and must be revisited if users can select different Plane workspaces/projects.
- Existing generated .NET artifacts and conversation data changes were preserved.

## LAST SESSION HANDOFF

```text
Date: 2026-09-23

Current Phase: Phase 4 complete; ready for Phase 5.

Last completed task: Replaced the singleton Plane user credential with authenticated, per-call credential resolution and trusted MCP context propagation.

Current implementation state: POST /api/chat passes verified req.user.id to AgentService. Plane ToolRegistry calls resolve (userId, plane), then sends the decrypted key only as an internal X-Plane-API-Key header. Plane MCP requires MCP_INTERNAL_TOKEN and PlaneAPIServices reads request-scoped headers without storing mutable user state.

Files that matter: be/src/mcpClient.js, be/src/toolRegistry.js, be/src/agentService.js, be/src/server.js, be/src/integrationService.js, PlaneMCPServer/Program.cs, PlaneMCPServer/PlaneAPIServices.cs.

Commands already run: repository/runtime trace; npm test with escalation; dotnet build --no-restore with isolated OutputPath; git diff --check.

Tests status: 14 passed, 0 failed; .NET isolated build passed with 0 warnings/errors.

Known issues: SEC-003 remains open for Discord. Global Plane Workspace/ProjectId are intentionally retained. Do not duplicate integration storage in .NET.

Important architecture decisions: Node is the authoritative integration store; Pattern A per-call context is used; no mutable current user; Plane MCP singleton is stateless; MCP_INTERNAL_TOKEN protects the process boundary.

DO NOT redo: Phase 0-4 auth, persistence, Plane linking, or Plane context work.

NEXT ACTION: Start Phase 5: determine and implement the correct Discord multi-user authorization model, choosing shared bot plus mapping or per-user/per-workspace authorization.

Recommended first command for next session: Get-Content -Raw MULTI_USER_INTEGRATION_PLAN.md; Get-Content DiscordMCPServer/Program.cs; Get-Content DiscordMCPServer/DiscordAPIServices.cs; rg -n "Discord|Channel|Guild|User|MCP" DiscordMCPServer be/src
```

# Phase 5 completion update (2026-09-23)

## CURRENT STATUS

```text
PHASE 0 - Repository Audit: DONE
PHASE 1 - Authentication: DONE
PHASE 2 - User Integration Model: DONE
PHASE 3 - Plane Account Linking: DONE
PHASE 4 - Plane Per-User Context: DONE
PHASE 5 - Discord Integration Strategy: DONE
PHASE 6 - Integration Settings UI: NOT STARTED
```

## Repository Findings

```text
DiscordMCPServer/Program.cs loaded one DiscordBotToken from .NET User Secrets or
environment and one DiscordChannelId from appsettings.json. It registered one
singleton DiscordAPIServices and exposed a shared Streamable HTTP MCP endpoint
on port 3002.

DiscordMCPServer/DiscordAPIServices.cs sent POST messages to the global channel
using the application bot token in an Authorization: Bot header. It did not use
OAuth user tokens, webhooks, guild selection, or user identity. DiscordTools.cs
exposed only message content to the LLM; the destination was hidden but globally
fixed.

The actual use case is notification-only: Plane actions can result in a Discord
notification. There is no requirement for users to authorize personal Discord
accounts or unrelated servers. Model A (shared bot plus per-user destination
mapping) is therefore the smallest correct architecture.
```

## Architecture Decisions

ADR-009
Decision:
Use Model A: one application-level Discord bot token with one validated
guild/channel destination mapping per authenticated application user.

Reason:
The existing Discord integration only sends notifications, has one organization
bot, and has no user OAuth or delegated-account use case. Plane’s per-user
credential model does not imply Discord needs per-user OAuth.

Credential ownership:
`DiscordBotToken` remains server-side .NET application configuration. It is not
copied into `user_integrations` and is never returned to Node, the frontend, or
the model.

Trusted routing:
`req.user.id` resolves the user’s Discord integration in Node. Node injects
`X-Discord-Guild-Id` and `X-Discord-Channel-Id` into the internal MCP call.
DiscordTools has no guild/channel parameters. The .NET service uses only the
trusted channel header and the application bot token.

Concurrency:
No current-user, guild, or channel state is stored globally. The singleton
DiscordAPIServices is stateless apart from the application bot token and shared
HttpClient; destination headers are read from the current request.

## COMPLETED

- Added authenticated Discord status, connect, and disconnect endpoints.
- Added destination validation through a protected .NET internal endpoint that checks guild existence and channel/guild ownership using the bot.
- Added credentialless provider mapping support for Discord without weakening credential requirements for Plane.
- Added trusted per-user Discord execution context and internal MCP authentication using `MCP_INTERNAL_TOKEN`.
- Removed the global `DiscordChannelId` from active configuration.
- Prevented generic integration PUT from bypassing Discord destination validation.
- Kept the LLM tool schema limited to message content; model-supplied IDs cannot override routing.

## FILES CHANGED

```text
be/src/discordLinking.js
be/src/integrationService.js
be/src/server.js
be/src/toolRegistry.js
be/src/config.js
be/.env.example
be/test/discordLinking.test.js
be/test/mcpContext.test.js
DiscordMCPServer/Program.cs
DiscordMCPServer/DiscordAPIServices.cs
DiscordMCPServer/DiscordDestinationRequest.cs
DiscordMCPServer/appsettings.json
MULTI_USER_INTEGRATION_PLAN.md
```

## TESTS RUN

```text
npm test -> PASS (18 tests, 0 failures; outside sandbox because Node path resolution is EPERM in the sandbox)
dotnet build --no-restore -p:OutputPath=tmp-phase5-build\ -> PASS (0 warnings, 0 errors)
dotnet test --no-build -> PASS/no test output; no .NET test project exists
git diff --check -> PASS
```

Tests cover A/B mapping ownership, concurrent A/B routing, model destination
spoofing, invalid destination rejection, missing configuration, validation
failure without persistence, and bot-token non-persistence.

## SECURITY FINDINGS

- SEC-003 RESOLVED: Discord now uses explicit shared-bot Model A routing; destinations are validated and resolved from authenticated user mappings, with no fallback channel and no model-controlled destination.
- SEC-005 RESOLVED globally for current Plane and Discord execution: both providers receive trusted backend context, not model-selected identity. The internal MCP token protects both HTTP MCP servers.
- The Discord bot token remains an application secret in .NET User Secrets/environment and is never persisted per user, returned, logged, or placed in LLM context.
- Existing generated .NET artifacts and conversation data changes were preserved.

## ISSUES / BLOCKERS

- `MCP_INTERNAL_TOKEN` must be configured identically in Node and Discord MCP deployments.
- Destination validation confirms bot access to the guild and channel ownership; actual send permission remains subject to Discord permission changes and is reported as a safe send failure.
- The JSON integration store remains the authoritative mapping store; no database migration was introduced.

## LAST SESSION HANDOFF

```text
Date: 2026-09-23

Current Phase: Phase 5 complete; ready for Phase 6.

Last completed task: Classified Discord as shared bot plus per-user destination mapping and implemented validated trusted routing.

Current implementation state: POST /api/integrations/discord/connect validates guild/channel through the protected Discord MCP internal endpoint, then stores only the user-owned mapping. Discord MCP calls receive the current user’s channel through internal headers; the LLM sees only message content.

Files that matter: be/src/discordLinking.js, be/src/integrationService.js, be/src/toolRegistry.js, be/src/server.js, DiscordMCPServer/Program.cs, DiscordMCPServer/DiscordAPIServices.cs, DiscordMCPServer/DiscordTools.cs.

Commands already run: Discord runtime audit; npm test with escalation; isolated Discord .NET build; dotnet test --no-build; git diff --check.

Tests status: 18 passed, 0 failed; Discord build passed with 0 warnings/errors.

Known issues: Phase 6 UI is not started. Existing generated artifacts and conversation data changes were preserved.

Important architecture decisions: Discord Model A shared bot; per-user guild/channel mapping; Node owns mappings; MCP_INTERNAL_TOKEN protects the process; no per-user Discord OAuth.

DO NOT redo: Phase 0-5 authentication, persistence, Plane, or Discord routing work.

NEXT ACTION: Start Phase 6: build authenticated integration settings UI for Plane and Discord status/connect/disconnect without exposing secrets.

Recommended first command for next session: Get-Content -Raw MULTI_USER_INTEGRATION_PLAN.md; rg -n "integrations|profile|Plane|Discord|chat" fe LibreChat/client --glob '!node_modules/**'
```

## user_integrations

```text
id
user_id
provider
external_user_id
access_token_encrypted
refresh_token_encrypted
expires_at
workspace_id
guild_id
metadata
created_at
updated_at
```

Provider ví dụ:

```text
plane
discord
```

Không bắt buộc dùng đúng schema này nếu project đã có model tương tự.

Ưu tiên reuse model hiện tại thay vì tạo bảng trùng chức năng.

---

# 5. Security requirements

Bắt buộc:

- Không lưu token dạng plaintext nếu có khả năng mã hóa.
- Không trả Plane/Discord access token xuống frontend.
- Không log access token.
- Không commit `.env`.
- Không cho frontend gửi `userId` rồi backend tin trực tiếp.
- Backend phải xác định current user từ session/JWT/token đã verify.
- Mọi integration lookup phải theo authenticated user.
- Mỗi endpoint liên quan tài khoản phải kiểm tra ownership.
- Không để MCP tool nhận arbitrary `userId` mà không validate.
- Không để User A có thể thay request để lấy integration của User B.

Nếu phát hiện code hiện tại vi phạm các nguyên tắc này, phải ghi vào `SECURITY FINDINGS`.

---

# 6. Implementation Phases

# PHASE 0 — Repository Audit

## Mục tiêu

Hiểu đầy đủ hệ thống hiện tại trước khi sửa.

## Việc cần làm

- [ ] Xác định cấu trúc FE.
- [ ] Xác định cấu trúc BE.
- [ ] Xác định DB đang dùng.
- [ ] Xác định schema/model User hiện có.
- [ ] Xác định authentication hiện có.
- [ ] Xác định Plane API client.
- [ ] Xác định Plane MCP tool/server.
- [ ] Xác định Discord API/MCP integration.
- [ ] Tìm credential Plane đang được lấy từ đâu.
- [ ] Tìm credential Discord đang được lấy từ đâu.
- [ ] Tìm mọi chỗ hard-code account/token.
- [ ] Xác định luồng FE -> BE -> Agent/MCP -> Plane/Discord.
- [ ] Ghi lại repository findings.

## Không code lớn ở Phase này.

Chỉ sửa lỗi nhỏ nếu cần để repository chạy được.

---

# PHASE 1 — Authentication

## Mục tiêu

Mỗi request từ frontend tới backend phải xác định được user.

## Yêu cầu

Nếu project chưa có authentication:

- [ ] Chọn cơ chế login phù hợp với stack hiện tại.
- [ ] Ưu tiên Google OAuth/OpenID Connect nếu requirement là login Google.
- [ ] Tạo hoặc reuse User model.
- [ ] Sau login tạo session hoặc access token.
- [ ] Backend middleware xác thực request.
- [ ] Có `currentUser` / `request.user` tương đương.
- [ ] Frontend có trạng thái logged-in/logged-out.
- [ ] Có logout.

Nếu authentication đã tồn tại:

- [ ] Audit security.
- [ ] Verify backend lấy user từ auth context.
- [ ] Không tạo cơ chế auth thứ hai nếu không cần.

## Acceptance Criteria

- User A login -> backend nhận User A.
- User B login -> backend nhận User B.
- Request không login tới protected endpoint -> bị từ chối.
- User identity không phụ thuộc body/query do frontend tự khai báo.

---

# PHASE 2 — User Integration Model

## Mục tiêu

Thay credential dùng chung bằng integration riêng theo user.

## Việc cần làm

- [ ] Thiết kế/reuse bảng `user_integrations`.
- [ ] Migration database.
- [ ] Relation User -> Integrations.
- [ ] Provider enum/type.
- [ ] Có API/service lấy integration theo current user.
- [ ] Có cơ chế lưu credential an toàn.
- [ ] Không trả secret trong API response.

## Service interface mong muốn

Ví dụ:

```text
getIntegration(userId, provider)
saveIntegration(userId, provider, credentials)
disconnectIntegration(userId, provider)
refreshIntegrationToken(userId, provider)
```

Tên hàm có thể khác theo conventions của project.

---

# PHASE 3 — Plane Account Linking

## Mục tiêu

Mỗi user kết nối Plane account hoặc Plane identity riêng.

## Codex cần inspect trước

Xác định Plane đang dùng:

- API token
- Personal access token
- OAuth
- Cookie/session
- Workspace API key
- MCP server credential cố định
- Cách khác

Không giả định.

## Sau khi xác định

Implement flow thích hợp.

### Nếu Plane hỗ trợ OAuth phù hợp

Flow:

```text
User
 -> Connect Plane
 -> Plane authorization
 -> callback backend
 -> store access/refresh token
 -> associate with current user
```

### Nếu Plane dùng personal API token

Flow có thể là:

```text
User
 -> Integration Settings
 -> nhập API token
 -> Backend validate token
 -> encrypt/store
 -> associate token with user
```

Không lưu token trong localStorage nếu không cần thiết.

## Acceptance Criteria

- User A kết nối Plane A.
- User B kết nối Plane B.
- Backend lookup Plane credential theo current user.
- User A không thể dùng integration của User B.
- Plane API request chạy đúng account/workspace.

---

# PHASE 4 — Refactor Plane API / MCP to Per-User Context

## Mục tiêu

Loại bỏ Plane credential global.

## Trước đây

Ví dụ:

```text
PLANE_API_TOKEN=<one token>
```

và toàn bộ tool dùng token đó.

## Mục tiêu

```text
authenticated request
   -> currentUser.id
   -> IntegrationService.getPlaneIntegration(currentUser.id)
   -> PlaneClient(credentials)
   -> Plane API
```

## Việc cần làm

- [ ] Tìm toàn bộ Plane client initialization.
- [ ] Loại bỏ dependency vào một global user token nếu đó là user credential.
- [ ] Chuyển sang request-scoped/user-scoped credential.
- [ ] MCP tool nhận trusted context hoặc service đã bind user.
- [ ] Không cho model tự chọn credential.
- [ ] Test nhiều user.

## Lưu ý

Có thể vẫn giữ:

```text
PLANE_BASE_URL
PLANE_CLIENT_ID
PLANE_CLIENT_SECRET
```

ở `.env` nếu đây là application-level config.

Nhưng user-specific access token không nên là một global env duy nhất.

---

# PHASE 5 — Discord Integration Strategy

## Mục tiêu

Xác định Discord thật sự có cần API riêng từng user hay không.

Codex phải phân tích use-case trước khi implement.

Có 2 mô hình khác nhau.

## Model A — Shared Discord Bot

Phù hợp nếu:

- Hệ thống có một Discord server chung.
- Bot gửi notification cho từng người.
- User chỉ cần map với Discord user/channel.

Kiến trúc:

```text
One Discord Bot Token
      |
      v
Backend
      |
      +-- app user A -> discordUserId A
      +-- app user B -> discordUserId B
```

Trong trường hợp này KHÔNG cần bot token riêng cho từng người.

Chỉ cần mapping user.

## Model B — Per-user / per-workspace Discord authorization

Phù hợp nếu:

- Mỗi user kết nối Discord account/server riêng.
- Hệ thống cần truy cập server khác nhau theo user.
- OAuth permission khác nhau.

Khi đó lưu Discord integration theo user.

## Task

- [ ] Xác định use-case hiện tại thuộc A hay B.
- [ ] Ghi quyết định vào Architecture Decisions.
- [ ] Implement theo mô hình phù hợp.
- [ ] Không ép Discord thành per-user token nếu bot dùng chung hợp lý hơn.

---

# PHASE 6 — Integration Settings UI

## Mục tiêu

User nhìn thấy trạng thái integration của chính mình.

Ví dụ trang:

```text
Account

Google
Connected as:
user@gmail.com

Plane
Status: Connected
Workspace: ...
[Disconnect]

Discord
Status: Connected
Server/User: ...
[Disconnect]
```

## Việc cần làm

- [ ] FE gọi `/me`.
- [ ] FE hiển thị user đang login.
- [ ] FE hiển thị trạng thái Plane.
- [ ] FE hiển thị trạng thái Discord.
- [ ] Connect action.
- [ ] Disconnect action.
- [ ] Error state.
- [ ] Loading state.
- [ ] Không hiển thị raw access token.

---

# PHASE 7 — Authorization & Isolation Tests

## Test case bắt buộc

### Authentication

- [ ] Anonymous cannot access protected APIs.
- [ ] User A session resolves User A.
- [ ] User B session resolves User B.

### Plane

- [ ] User A Plane query uses A credentials.
- [ ] User B Plane query uses B credentials.
- [ ] A cannot request B integration by changing request body.
- [ ] A cannot disconnect B Plane integration.
- [ ] Missing Plane connection gives clear error.
- [ ] Expired/revoked token handled correctly.

### Discord

- [ ] Correct destination/user/server is selected.
- [ ] User A cannot change B Discord mapping.
- [ ] Missing Discord integration handled correctly.

### MCP / Agent

- [ ] Model cannot switch identity via prompt injection.
- [ ] MCP tool does not trust a model-provided userId directly.
- [ ] Authenticated context reaches tool execution.
- [ ] Tool returns only authorized data.

---

# PHASE 8 — Error Handling

Cần xử lý rõ:

- [ ] Login failed.
- [ ] Session expired.
- [ ] Plane not connected.
- [ ] Discord not connected.
- [ ] Plane token invalid.
- [ ] Plane token expired.
- [ ] Discord permission missing.
- [ ] External API unavailable.
- [ ] Rate limit.
- [ ] Database integration missing.
- [ ] Unauthorized resource.
- [ ] Integration belongs to another user.

Không expose secret trong error response.

---

# PHASE 9 — Logging & Observability

Log nên có:

```text
requestId
userId
provider
toolName
success/failure
duration
external status code
```

Không log:

```text
access_token
refresh_token
API secret
Authorization header
```

Có thể log `userId`, nhưng tránh log thông tin không cần thiết.

---

# PHASE 10 — Remove Legacy Single-Account Behavior

Chỉ thực hiện sau khi multi-user flow hoạt động.

- [ ] Tìm global Plane user token cũ.
- [ ] Tìm global Discord user credential cũ.
- [ ] Xóa code fallback nguy hiểm.
- [ ] Xóa dead code.
- [ ] Update `.env.example`.
- [ ] Update docs.
- [ ] Verify không có secret bị commit.

Nếu vẫn cần service-level credential thì phải ghi rõ:

```text
Application Credential
```

khác với:

```text
User Credential
```

---

# PHASE 11 — Full Code Review

PHASE NÀY BẮT BUỘC.

Không đánh dấu project hoàn thành ngay sau khi code chạy.

Codex phải thực hiện review toàn bộ thay đổi.

## Review 1 — Git diff review

Chạy:

```bash
git status
git diff
git diff --staged
```

Đọc toàn bộ diff.

Tìm:

- logic sai
- duplicated code
- temporary code
- debug logs
- hardcoded user id
- hardcoded token
- TODO chưa xử lý
- error handling thiếu
- security issue
- naming không nhất quán

---

## Review 2 — Authentication review

Kiểm tra:

- Identity lấy từ đâu?
- Có tin userId từ frontend không?
- Protected routes đã protect chưa?
- Token/session verify ở server chưa?
- Logout/session expiry hoạt động chưa?

---

## Review 3 — Authorization review

Kiểm tra ownership:

```text
User A
   |
   X must NOT access
   |
User B integration
```

Tìm mọi endpoint nhận:

```text
userId
integrationId
workspaceId
```

và kiểm tra authorization.

---

## Review 4 — MCP security review

Đặc biệt kiểm tra:

```text
User -> Prompt -> LLM -> MCP
```

LLM không phải security boundary.

Nếu tool có dạng:

```text
get_tasks(user_id)
```

và `user_id` do model truyền vào, cần xem lại thiết kế.

Ưu tiên:

```text
authenticatedContext.userId
```

được inject bởi backend/tool runtime.

---

## Review 5 — Secrets review

Search repository:

```text
token
api_key
secret
authorization
bearer
PLANE_
DISCORD_
```

Verify không có secret thật bị commit.

---

## Review 6 — Build/Test

Chạy các command phù hợp với repository, ví dụ:

```bash
npm test
npm run lint
npm run build
```

hoặc:

```bash
dotnet test
dotnet build
```

hoặc Python equivalents.

Không tự giả định command.

Đọc package/config trước.

---

## Review 7 — Multi-user manual scenario

Test ít nhất:

```text
User A login
 -> connect Plane A
 -> query task
 -> result belongs to Plane A

User B login
 -> connect Plane B
 -> query task
 -> result belongs to Plane B

Switch back User A
 -> still Plane A
```

Discord tương tự theo architecture đã chọn.

---

# 7. Definition of Done

Chỉ đánh dấu hoàn thành khi:

- [ ] Authentication hoạt động.
- [ ] Backend xác định current user.
- [ ] Plane integration theo user.
- [ ] Discord architecture đã được quyết định rõ.
- [ ] Discord integration hoạt động theo architecture đó.
- [ ] Không còn user credential global không hợp lý.
- [ ] Authorization test pass.
- [ ] MCP identity isolation pass.
- [ ] Build pass.
- [ ] Tests pass hoặc ghi rõ test nào chưa có.
- [ ] Git diff được review.
- [ ] Security review hoàn thành.
- [ ] Documentation cập nhật.
- [ ] LAST SESSION HANDOFF cập nhật.
- [ ] Không còn blocker chưa được ghi lại.

---

# 8. Quy tắc cập nhật file sau mỗi task

Sau mỗi task đáng kể, cập nhật:

## CURRENT STATUS

Ví dụ:

```text
Phase 1: DONE
Phase 2: IN PROGRESS
Phase 3: NOT STARTED
```

## COMPLETED

Ghi:

```text
- Added auth middleware.
- Added GET /api/me.
- Created UserIntegration model.
```

## FILES CHANGED

Ví dụ:

```text
backend/src/auth/middleware.ts
backend/src/users/user.model.ts
backend/src/integrations/integration.service.ts
frontend/src/auth/AuthProvider.tsx
```

## TESTS RUN

Ví dụ:

```text
npm run lint -> PASS
npm test -> PASS
npm run build -> PASS
```

## ISSUES / BLOCKERS

Ví dụ:

```text
Plane OAuth support chưa xác nhận.
Hiện Plane integration đang dùng API token trong env.
```

## NEXT ACTION

Chỉ ghi 1-3 action cụ thể.

Ví dụ:

```text
1. Inspect PlaneClient initialization.
2. Replace global token with IntegrationService lookup.
3. Add two-user isolation test.
```

---

# 9. LAST SESSION HANDOFF

Phần này phải được cập nhật trước khi dừng một Codex session.

Template:

```text
Date:

Current Phase:

Last completed task:

Current implementation state:

Files that matter:

Commands already run:

Tests status:

Known issues:

Important architecture decisions:

DO NOT redo:

NEXT ACTION:

Recommended first command for next session:
```

Latest handoff (2026-09-23):

Current Phase: Phase 1 - Authentication, in progress.
Last completed task: Phase 0 audit and first authentication hardening pass.
Current implementation state: be/src/auth.js verifies the browser's LibreChat
session via GET /api/user/ and sets req.user. Project chat, history, MCP, and
proxy routes require this middleware. Conversation ownership uses req.user.id.
Files that matter: be/src/auth.js, be/src/server.js, MULTI_USER_INTEGRATION_PLAN.md,
PlaneMCPServer/Program.cs, DiscordMCPServer/Program.cs.
Commands already run: dotnet build --no-restore in both MCP projects; source
inspection; git status/diff.
Tests status: .NET builds pass. Node syntax checks are blocked by sandbox path
resolution and an existing mojibake regex in mcpTarget.js when piped through
stdin. No backend test script exists in be/package.json.
Known issues: SEC-001 is addressed for protected project routes; SEC-002 to
SEC-005 remain open. Add focused auth/ownership tests before marking Phase 1
done. Preserve pre-existing generated artifacts and conversation data changes.
Important architecture decisions: LibreChat verified backend identity is the
only trusted identity source; Discord remains shared bot plus authorized mapping.
DO NOT redo: repository audit, credential tracing, or the initial auth middleware.
NEXT ACTION: Add focused anonymous rejection and two-user ownership tests; run
available backend checks; review diff; finish Phase 1 checklist.
Recommended first command for next session: Get-Content -Raw
MULTI_USER_INTEGRATION_PLAN.md; git status --short; Get-Content be/package.json

Latest handoff (2026-09-23, Phase 1 complete):

Current Phase: Phase 2 - User Integration Model, not started.
Last completed task: Finished Phase 1 authentication review and isolation tests.
Current implementation state: requireAuthenticatedUser verifies the incoming
LibreChat session through /api/user/. Protected project routes use req.user.id;
ownership is centralized in ownership.js. User-facing proxy forwarding preserves
the verified browser credentials and does not substitute LIBRECHAT_SERVICE_TOKEN.
Files that matter: be/src/auth.js, be/src/ownership.js, be/src/server.js,
be/test/auth.test.js, be/package.json, MULTI_USER_INTEGRATION_PLAN.md.
Commands already run: npm test; node --check src/auth.js; node --check
src/ownership.js; node --check src/server.js; git diff/status; both MCP builds.
Tests status: 4 authentication/isolation tests pass; changed-file syntax checks
pass outside the sandbox. Sandbox Node execution fails before discovery with
EPERM resolving C:\Users\pc, so the successful checks used escalation.
Known issues: SEC-002 Plane singleton credential, SEC-003 Discord access, and
SEC-005 missing MCP trusted context remain open. Existing generated artifacts and
conversation data changes are preserved.
Important architecture decisions: verified backend auth is the only identity
source; Discord remains shared bot plus authorized mapping.
DO NOT redo: Phase 0 audit or Phase 1 authentication implementation/tests.
NEXT ACTION: Design the user-scoped integration model and persistence/secret
protection approach, then implement Phase 2 only.
Recommended first command for next session: Get-Content -Raw
MULTI_USER_INTEGRATION_PLAN.md; git status --short; npm test --prefix be

Một session mới phải đọc phần này trước khi làm tiếp.

---

# 10. Repository Findings

> CODEX: cập nhật sau PHASE 0.

## Frontend

```text
React/TypeScript LibreChat-derived frontend in fe/. Existing LibreChat client
auth UI lives under LibreChat/client/; the project frontend is not an auth
authority.
```

## Backend

```text
Node.js 18+ Express service in be/src/. It owns project chat, JSON history,
Gemini orchestration, MCP routing, CORS, and the LibreChat proxy.
```

## Database

```text
No project database or ORM. Conversations are stored in
be/data/conversations.json. LibreChat owns its own user/session persistence.
```

## Authentication

```text
LibreChat supports verified cookie/JWT/session authentication and exposes
/api/auth/me. The project facade forwards headers upstream, but its local
fallback hashes any presented Authorization value or creates an unsigned
project_owner cookie; this is not verified authentication.
```

## Plane Integration

```text
PlaneMCPServer is an ASP.NET Core .NET 10 MCP HTTP server on port 3003.
PlaneAPIKey is loaded once from User Secrets/environment into a singleton
PlaneAPIServices. BaseUrl, Workspace, and ProjectId are application config.
```

## Discord Integration

```text
DiscordMCPServer is an ASP.NET Core .NET 10 MCP HTTP server on port 3002.
DiscordBotToken is loaded once from User Secrets/environment into a singleton
DiscordAPIServices; DiscordChannelId is application config. Current use-case is
a shared bot/channel notification model (Model A), not per-user Discord OAuth.
```

## MCP Architecture

```text
be/src/mcpClient.js maintains configured server clients and
be/src/toolRegistry.js exposes/invokes remote tools selected by the agent.
Calls contain only LLM-generated tool arguments; no verified backend identity
is propagated to either MCP server.
```

Audit checklist completed:

- [x] Identified FE/BE frameworks, storage, existing auth, Plane/Discord clients, and MCP path.
- [x] Located Plane credential initialization in PlaneMCPServer/Program.cs.
- [x] Located Discord credential initialization in DiscordMCPServer/Program.cs.
- [x] Confirmed no project User or user_integrations model exists.
- [x] Confirmed current credentials are singleton application credentials.

---

# 11. Architecture Decisions

Ghi các quyết định quan trọng để session khác không thiết kế lại từ đầu.

Template:

```text
ADR-001
Decision:
Reason:
Alternatives considered:
Impact:
```

Ví dụ:

```text
ADR-001
Decision:
Backend authenticated user is the only trusted source of user identity.

Reason:
LLM/frontend parameters must not determine security identity.

Impact:
MCP tools must receive/inherit authenticated context rather than arbitrary userId.
```

ADR-002
Decision:
Use LibreChat's verified backend authentication/session as the only trusted
identity source for the project facade; do not treat project_owner or a raw
Authorization value as authenticated identity.

Reason:
The frontend and LLM are untrusted inputs. The existing fallback does not prove
who the caller is.

Alternatives considered:
Add a second project login system; rejected because it duplicates LibreChat
authentication and creates identity-linking risk.

Impact:
Protected project endpoints must resolve request.user from verified upstream
auth or a separately verified token before conversation/integration access.

ADR-003
Decision:
Keep Discord as a shared bot plus per-application-user destination mapping
(Model A) unless a requirement for cross-server user authorization appears.

Reason:
The current tool sends notifications to one configured channel and has no
per-user Discord OAuth use-case.

Impact:
The Discord bot token remains an application credential on the server; only
authorized mapping metadata may become user-scoped. It must never reach the
browser or LLM.
```

---

# 12. SECURITY FINDINGS

> CODEX: cập nhật nếu phát hiện vấn đề.

Template:

```text
SEC-001
Severity: High
File: be/src/server.js:104-110
Issue: getOwnerId trusts any Authorization header string or an unsigned
project_owner cookie and hashes it as the user identity.
Risk: An attacker can choose a different header/cookie and access another
conversation namespace; this is not verified authentication.
Fix: Require verified LibreChat request.user/session context and derive the
internal user id only from that context.
Status: Resolved in Phase 1; verified LibreChat auth is required and the
unsigned project_owner fallback was removed.

SEC-002
Severity: High
File: PlaneMCPServer/Program.cs:13-41
Issue: One PlaneAPIKey is loaded into a singleton service for every MCP caller.
Risk: All users operate as one Plane account with no user authorization.
Fix: Bind authenticated user context to a per-user integration lookup before
constructing the Plane client; remove user credential singleton behavior.
Status: Open; Phase 2-4.

SEC-003
Severity: Medium
File: DiscordMCPServer/Program.cs:12-42
Issue: Shared Discord bot/channel credentials have no caller identity or
destination authorization context.
Risk: Any caller able to reach the MCP endpoint can invoke notification tools.
Fix: Keep the bot server-side, restrict MCP access to the authenticated backend,
and pass an authorized destination/mapping context.
Status: Open; Phase 5.

SEC-004
Severity: High
File: be/src/server.js:223-230, 441-463
Issue: Project endpoints proxy or expose operations without a verified auth
guard; MCP catalog/test endpoints are also unprotected.
Risk: Anonymous or spoofed callers may discover/invoke configured integrations.
Fix: Add fail-closed auth middleware and explicit per-route authorization.
Status: Resolved for project routes in Phase 1; all integration-capable project
routes now require auth. MCP endpoint hardening remains part of Phase 7.

SEC-005
Severity: Medium
File: be/src/mcpClient.js, be/src/toolRegistry.js
Issue: MCP calls carry only model-selected arguments and no trusted user context.
Risk: Prompt injection could select another user's integration if future tools
accept userId-like arguments.
Fix: Inject authenticated context server-side and reject arbitrary userId at the
MCP boundary.
Status: Open; Phase 4 and 7.

No plaintext Plane or Discord secret was found in the inspected source/config
files; credentials are expected via User Secrets/environment. Runtime and
generated artifacts are already present and modified in git status.

Phase 1 review finding resolved: user-facing LibreChat proxy forwarding no
longer substitutes LIBRECHAT_SERVICE_TOKEN for the verified user's credentials.
```

---

# 13. CURRENT STATUS

Current status override (latest audit): Phase 0 is DONE; Phase 1 is IN PROGRESS.
The legacy checklist immediately below has not been rewritten because its
non-ASCII phase labels are encoded inconsistently in this file.

Phase 1 checkpoint: authentication middleware and verified-user ownership
binding are implemented, but Phase 1 is not DONE until tests and route coverage
are completed.

Current status override (Phase 1 close): Phase 0 is DONE; Phase 1 is DONE;
Phase 2 is NOT STARTED. Phase 1 route review and focused isolation tests pass.

```text
PHASE 0 — Repository Audit: NOT STARTED
PHASE 1 — Authentication: NOT STARTED
PHASE 2 — User Integration Model: NOT STARTED
PHASE 3 — Plane Account Linking: NOT STARTED
PHASE 4 — Plane Per-User Context: NOT STARTED
PHASE 5 — Discord Integration Strategy: NOT STARTED
PHASE 6 — Integration Settings UI: NOT STARTED
PHASE 7 — Authorization & Isolation Tests: NOT STARTED
PHASE 8 — Error Handling: NOT STARTED
PHASE 9 — Logging & Observability: NOT STARTED
PHASE 10 — Remove Legacy Single Account: NOT STARTED
PHASE 11 — Full Code Review: NOT STARTED
```

---

# 14. COMPLETED

```text
- Completed Phase 0 repository audit and documented the FE/BE/MCP/auth architecture.
- Identified singleton Plane/Discord credentials and missing verified identity propagation.
- Added be/src/auth.js to verify the incoming LibreChat session through /api/user/.
- Protected project chat/history/MCP/proxy routes with fail-closed authentication.
- Conversation ownership now uses verified req.user.id; frontend and LLM userId values are ignored.
- Added dependency-free Node built-in tests for auth rejection, verified identity, and two-user isolation.
- Removed the LibreChat service-token override from user-facing proxy forwarding so upstream keeps the verified user's session.
```

---

# 15. FILES CHANGED

```text
- MULTI_USER_INTEGRATION_PLAN.md
- be/src/auth.js
- be/src/server.js
- be/src/ownership.js
- be/package.json
- be/test/auth.test.js
```

---

# 16. TESTS RUN

```text
- Repository inspection completed; build/syntax checks pending at the Phase 0 checkpoint.
- dotnet build --no-restore (PlaneMCPServer) -> PASS, 0 warnings/errors.
- dotnet build --no-restore (DiscordMCPServer) -> PASS, 0 warnings/errors.
- Node syntax check -> BLOCKED by sandbox path resolution; stdin check also exposed existing mojibake in mcpTarget.js.
- Git diff reviewed for source changes; generated bin/obj and conversation data changes pre-existed and were preserved.
- npm test -> PASS (4 tests, 0 failures; run outside sandbox because Node path resolution is sandbox-blocked).
- node --check src/auth.js -> PASS (outside sandbox).
- node --check src/ownership.js -> PASS (outside sandbox).
- node --check src/server.js -> PASS (outside sandbox).
```

---

# 17. ISSUES / BLOCKERS

Phase 0 audit is complete. Open security findings SEC-001 through SEC-005 are
not resolved. Existing generated bin/obj changes and be/data/conversations.json
were present before this work and must be preserved.

Phase 1 is complete. SEC-002, SEC-003, and SEC-005 remain open for later
per-user integration/MCP work; these are not blockers for the authentication
phase but do block final project completion.

```text
Need repository audit first.

Need to determine exactly how Plane authentication currently works.

Need to decide whether Discord should use:
A. one shared bot + per-user mapping
or
B. per-user Discord authorization.
```

---

# 18. NEXT ACTION

1. Run Phase 0 build/syntax checks and review git diff.
2. Implement Phase 1 fail-closed authentication middleware using verified LibreChat auth/session context.
3. Add authenticated request.user propagation without trusting frontend/LLM userId.

Current next action override:
1. Start Phase 3 by inspecting the exact Plane authentication mechanism.
2. Design account linking/credential registration for the authenticated user.
3. Preserve the Phase 2 invariant: Plane credentials are stored per verified LibreChat user and are not returned to the browser.

```text
1. Inspect repository architecture.
2. Trace FE -> BE -> MCP/API -> Plane/Discord.
3. Identify where Plane and Discord credentials are currently stored and initialized.
4. Update Repository Findings in this file.
5. Do not start major refactor until the above is complete.
```

---

# 19. Prompt cho Codex ở phiên mới

Dùng prompt này khi mở một session Codex mới:

```text
Read the project tracking file:

MULTI_USER_INTEGRATION_PLAN.md

Treat this file as the source of truth for the implementation.

First read:
- CURRENT STATUS
- LAST SESSION HANDOFF
- NEXT ACTION
- Architecture Decisions
- SECURITY FINDINGS

Then inspect git status and the relevant files.

Do not restart the implementation from the beginning.

Continue exactly from NEXT ACTION.

Rules:
1. Do not trust userId supplied by the frontend or LLM as authenticated identity.
2. User identity must come from verified backend auth/session context.
3. Plane/Discord user credentials must never be exposed to the frontend.
4. Update MULTI_USER_INTEGRATION_PLAN.md after every meaningful completed task.
5. Before the session ends, update LAST SESSION HANDOFF.
6. Run appropriate tests/build checks after each phase.
7. Review git diff before marking a phase DONE.
8. After implementation is complete, execute PHASE 11 — Full Code Review.
9. Do not mark the project DONE while unresolved security or authorization issues remain.
10. If context is getting large, stop at a safe checkpoint, update the tracking file, and leave a precise NEXT ACTION for the next session.

Start by reporting:
- current phase
- current repository state
- what you will work on next

Then proceed with the implementation.
```

---

## LATEST SESSION OVERRIDE — PHASE 5.5 (2026-09-23)

Phase 5.5 User Login Flow is implemented, with the manual two-user browser
smoke test pending. LibreChat remains the sole auth authority. The custom app
now has login via LibreChat email/password plus Google OAuth, session bootstrap,
protected routes, server logout, and `GET /api/me` derived from verified
`req.user.id`. Access tokens are memory-only; refresh remains in LibreChat's
HttpOnly cookie. Backend tests (19) and frontend production build pass.

Frontend typecheck remains blocked by pre-existing repository errors unrelated

---

# AUTHORITATIVE REPOSITORY AUDIT — 2026-09-23

The older phase checkpoints in this file are historical. This section is the
current source of truth and supersedes their status and next-action text.

## CURRENT STATUS

```text
PHASE 0 — Repository Audit: DONE
PHASE 1 — Authentication foundation: DONE
PHASE 2 — User Integration Model: DONE
PHASE 3 — Plane Account Linking: DONE
PHASE 4 — Plane Per-User Context: DONE
PHASE 5 — Discord Multi-User Authorization: DONE
PHASE 5.5 — Independent Application Login: IN PROGRESS / NEEDS REVIEW
PHASE 6 — Integration Settings UI: DONE (implemented and automated-tested)
PHASE 6.5 — PostgreSQL Persistence Migration: IN PROGRESS
PHASE 7 and later: NOT STARTED
```

Status update (2026-09-24): Phase 6.5 PostgreSQL Persistence Migration is
COMPLETE. Only Phase 5.5 manual refresh/logout verification remains in progress.

Manual verification update (2026-09-24): Real-cookie HTTP smoke verification
passed all three Phase 5.5 invariants, but direct browser verification was not
run because this environment has no Chrome, Edge, Firefox, or browser
automation connector. Phase 5.5 remains IN PROGRESS and must not be marked DONE
until the browser checks below are completed.

User confirmation update (2026-09-24): The user confirmed the three Phase 5.5
browser checks are complete. Phase 5.5 is now DONE. The real-cookie HTTP smoke
test and the user-confirmed browser verification together cover refresh
persistence, logout invalidation, and two-user session/data isolation.

Phase 7 update (2026-09-24): Authorization & Isolation Tests are DONE. Existing
coverage plus the new explicit tests cover anonymous rejection, expired/revoked
sessions, Plane credential/context isolation, Discord destination isolation,
MCP trusted context, model identity tampering, missing integrations, and
authorized conversation ownership.

Authoritative status override (2026-09-24): PHASE 5.5 DONE; PHASE 6 DONE;
PHASE 6.5 DONE; PHASE 7 DONE; PHASE 8 NOT STARTED. Next action is Phase 8
Error Handling.

Plane OAuth task update (2026-09-24): OAuth-first Plane connection is
IMPLEMENTED. PAT remains available under Advanced setup. Provider/manual OAuth
verification is pending because the local environment has no real Plane OAuth
client credentials or provider-specific authorization/token endpoints.

## COMPLETED

- Project-owned Google OIDC, hashed opaque `project_session`, `/api/me`, logout,
  and protected frontend routes are implemented.
- Per-user Plane and Discord integrations are stored and resolved by the
  authenticated application user.
- Plane and Discord MCP calls receive server-injected trusted context and
  require `MCP_INTERNAL_TOKEN`; model-supplied identity/destinations are not
  trusted.
- The authenticated Integration Settings UI is implemented for both providers.
- PostgreSQL repositories, schema, encrypted integration storage, and JSON
  migration tooling are implemented and live-verified.
- Re-ran the complete backend suite with elevated filesystem access: 26 tests
  passed and the PostgreSQL isolation test was skipped because no database URL
  is configured.
- Verified Docker is installed and responsive, but no PostgreSQL Compose
  service is running; the migration command reaches the database boundary and
  fails with the expected connection refusal on local port 5432.
- Started the local PostgreSQL service, enabled the database-backed isolation
  test, and completed the JSON migration. Migration output was 2 users, 2
  sessions, 0 integrations, 49 conversations, and 39 legacy conversation
  owners; source JSON files were preserved.
- Verified the live database contains migrated rows and preserves nullable
  legacy ownership for conversations that cannot be safely reassigned.
- Added Phase 7 authorization/isolation regression tests without changing
  production behavior.
- Added Plane OAuth-first connection flow with user-bound state, callback
  aliases, token/profile exchange, encrypted per-user persistence, safe
  account/workspace metadata, and Bearer propagation through trusted MCP
  context.
- Preserved PAT validation as an explicit Advanced setup fallback and kept
  Google application authentication unchanged.
- Added server-side OAuth refresh locking per user and fail-closed reconnect
  behavior when a Plane OAuth token expires without a usable refresh token.

## FILES CHANGED

```text
be/src/applicationAuth.js, be/src/auth.js, be/src/googleAuth.js
be/src/database.js, be/src/repositories.js, be/src/integrationService.js
be/src/server.js, be/src/agentService.js, be/src/toolRegistry.js
be/src/config.js, be/src/planeOAuth.js, be/src/planeLinking.js
be/schema.sql, be/docker-compose.yml, be/scripts/migrate-json-to-postgres.js
be/test/*.test.js (including auth, OAuth, and MCP isolation coverage)
fe/src/project-auth.jsx, fe/src/components/ProjectSettings.jsx
fe/src/components/project-settings.css
be/README.md, be/.env.example
PlaneMCPServer/Program.cs, PlaneMCPServer/PlaneAPIServices.cs
DiscordMCPServer/Program.cs, DiscordMCPServer/DiscordAPIServices.cs
MULTI_USER_INTEGRATION_PLAN.md
```

## TESTS RUN

```text
npm test (be) -> PASS: 26 passed, 0 failed, 1 skipped
  PostgreSQL test skipped because TEST_DATABASE_URL/DATABASE_URL is absent.
  The sandboxed invocation hit a Windows profile-path EPERM; the same command
  passed with elevated filesystem access.
npm run db:migrate-json (be, before starting PostgreSQL) -> BLOCKED:
  ECONNREFUSED on ::1/127.0.0.1:5432.
docker version -> PASS: Docker server 29.1.5; docker compose up -d postgres ->
  PASS; pg_isready -> accepting connections.
npm test (be, TEST_DATABASE_URL configured) -> PASS: 27 passed, 0 failed,
  0 skipped.
Phase 7 regression suite (same command after new authorization tests) -> PASS:
  30 passed, 0 failed, 0 skipped.
Plane OAuth implementation regression -> PASS: 31 passed, 0 failed, 0 skipped.
OAuth credential encryption/safe metadata test -> PASS.
OAuth refresh failure/reconnect test -> PASS.
Node syntax checks for changed backend files -> PASS.
Frontend production build after OAuth Settings changes -> PASS; existing
  dependency/chunk warnings only.
Temporary real-cookie HTTP smoke test -> PASS: refresh identity, logout
  invalidation, separate histories, and cross-user conversation denial.
npm run db:migrate-json (be, PostgreSQL running) -> PASS: migration.complete;
  users=2, sessions=2, integrations=0, conversations=49,
  legacyConversations=39.
PostgreSQL verification query -> PASS: migrated data present; 39 conversations
  retain legacy_owner_id and 9 have valid owner_id.
node --check changed backend files -> PASS
npm run build (fe) -> PASS; existing dependency/chunk warnings only
dotnet build --no-restore (PlaneMCPServer) -> PASS, 0 warnings/errors
dotnet build --no-restore (DiscordMCPServer) -> PASS, 0 warnings/errors
git diff --check -> PASS
```

## Repository Findings

- Frontend is React/Vite project mode with a login gate and authenticated
  Settings UI; it stores no credentials in browser storage.
- Node/Express owns authentication, sessions, repositories, integrations,
  conversation ownership, and MCP orchestration.
- PostgreSQL is the configured production persistence path; live PostgreSQL
  tests and migration verification passed in this session.
- Authentication is `Google -> Project Backend -> Application User -> Project
  Session -> req.user.id`. LibreChat is outside this trust chain.
- Plane is `req.user.id -> IntegrationService -> Plane credential -> trusted MCP
  context -> Plane MCP -> Plane API`; no global credential fallback exists and
  missing integration returns `PLANE_NOT_CONNECTED`.
- Discord is `req.user.id -> Discord integration mapping -> trusted destination
  -> Discord MCP -> Discord API`; the bot token is application-level only,
  routing is not model-controlled, and missing mapping fails closed.
- Phase 6 is already implemented and must not be restarted.

Security status update (2026-09-24): SEC-006 is RESOLVED for the implemented
PostgreSQL schema, repositories, migration, and live isolation verification.

Phase 7 checklist result (2026-09-24): COMPLETE.

- Authentication: anonymous access rejected; User A/User B sessions resolve the
  correct users; expired and revoked sessions fail closed.
- Plane: per-user credentials and trusted headers are isolated; request/body
  identity tampering cannot replace the authenticated owner; disconnect and
  missing-connection behavior are covered; expired/revoked OAuth refresh fails
  closed and requires reconnect.
- Discord: per-user guild/channel destinations are isolated; model-provided
  destinations cannot override trusted context; missing destinations fail
  closed.
- MCP/Agent: model-supplied `userId` cannot replace execution context; trusted
  user context reaches MCP; conversation ownership denies cross-user reads.

## Architecture Decisions

- Project authentication is independent from LibreChat; the older LibreChat
  authentication decision is superseded.
- Node is authoritative for per-user integration lookup and injects immutable
  execution context into shared MCP services.
- Plane uses per-user credentials with application-wide workspace/project scope.
- Discord uses one server-side shared bot plus per-user validated destinations.
- PostgreSQL is the target persistence layer with encrypted integration JSONB and
  opaque hashed sessions.

## SECURITY FINDINGS

```text
SEC-001 RESOLVED — verified project sessions determine req.user.id.
SEC-002 RESOLVED for normal Plane runtime — no global PlaneAPIKey is consumed;
  missing user integration fails closed.
SEC-003 RESOLVED for Discord Model A — server-side bot, validated per-user
  destinations, no fallback channel.
SEC-004 RESOLVED for project routes and MCP endpoints — auth and internal token
  guards are present.
SEC-005 RESOLVED for current Plane/Discord execution — trusted context is
  server-injected and concurrent isolation is tested.
SEC-006 OPEN — PostgreSQL live migration/persistence verification is incomplete.
```

## ISSUES / BLOCKERS

Latest security status (2026-09-24): SEC-006 is RESOLVED; live PostgreSQL
migration, isolation tests, and row-count verification passed.

Plane OAuth security status: application session remains the only identity
source; OAuth state is bound to `req.user.id`; client secrets and raw tokens
remain backend-only; integrations store encrypted credentials; safe responses
omit access and refresh tokens; MCP receives trusted Bearer context only.

### Plane OAuth manual verification checklist

- [ ] Configure real `PLANE_OAUTH_CLIENT_ID`, `PLANE_OAUTH_CLIENT_SECRET`,
  `PLANE_OAUTH_AUTHORIZE_URL`, `PLANE_OAUTH_TOKEN_URL`, and
  `PLANE_OAUTH_REDIRECT_URI`.
- [ ] Sign in as User A, click `Connect Plane`, authorize at Plane, and confirm
  callback returns to Settings with `Connected` account/workspace metadata.
- [ ] Sign in as User B and repeat; confirm A/B integrations and OAuth tokens
  remain isolated.
- [ ] Confirm `/api/integrations/plane` and Settings never expose access or
  refresh tokens; inspect backend DB JSONB only through a controlled operator
  query and confirm credentials are encrypted.
- [ ] Confirm a Plane MCP request from each user uses `Authorization: Bearer`
  for the matching OAuth token and never `X-API-Key` for OAuth.
- [ ] Revoke/expire an OAuth token, confirm server-side refresh when a refresh
  token exists, and confirm a clear reconnect error when refresh fails.
- [ ] Disconnect Plane and confirm local credentials are removed; provider-side
  revocation is only added if Plane documents a compatible endpoint.

### Phase 5.5 browser verification runbook

Use the running frontend at `http://localhost:3090` and backend proxy. Use two
separate browser profiles or one normal window plus one private window.

1. Sign in as User A. Confirm the UI shows User A, reload the page, and confirm
   the UI still shows User A. In DevTools Network, confirm `GET /api/me` is
   `200` after reload and in Application/Cookies confirm only the HttpOnly
   `project_session` cookie is used.
2. As User A, click Logout. Reload the page and call `GET /api/me` in DevTools
   or the console. It must return `401 AUTH_REQUIRED`; `POST /api/auth/refresh`
   using the old cookie must return `401 AUTH_SESSION_EXPIRED`. The UI must
   show the login screen.
3. Sign in as User A in profile A and User B in profile B at the same time.
   Confirm each profile's `/api/me` response has its own user id/profile.
   Create or view a conversation in each profile; each history must contain
   only its owner's data. Opening the other profile's conversation URL must
   return `404`, and integration status/settings must not cross over.

Automated real-cookie result: PASS for refresh identity, logout invalidation,
separate histories, and cross-user conversation denial. No production code fix
was required.

- User confirmation recorded: Phase 5.5 refresh persistence, logout
  invalidation, and two-user isolation checks passed.
- Google OAuth requires project credentials and an exact registered callback.
- Plane workspace/project scope remains global by design.
- Plane OAuth manual verification is blocked until real provider-specific
  client credentials, authorize URL, token URL, and registered callback are
  supplied. No endpoint or credential was invented.

## LAST SESSION HANDOFF

```text
Date: 2026-09-24
Current Phase: Plane OAuth-first integration implementation is complete; real
Plane provider/manual verification is pending. Phase 8 has not been started.
Last completed phase: Plane OAuth implementation and regression verification.
Current implementation state: Project-owned Google auth, per-user Plane and
Discord routing, Settings UI, and PostgreSQL persistence code are present.
Important architecture: Google -> Project Backend -> Application User ->
Project Session -> req.user.id; LibreChat is not in the auth trust chain.
Important security invariants: no model/frontend identity; no global Plane
fallback; Discord bot token is application-level only; missing integrations fail
closed; secrets remain backend-only/encrypted.
Files that matter: be/src/applicationAuth.js, be/src/auth.js,
be/src/googleAuth.js, be/src/server.js, be/src/integrationService.js,
be/src/toolRegistry.js, be/src/database.js, be/src/repositories.js,
PlaneMCPServer/Program.cs, PlaneMCPServer/PlaneAPIServices.cs,
DiscordMCPServer/Program.cs, DiscordMCPServer/DiscordAPIServices.cs,
fe/src/project-auth.jsx, fe/src/components/ProjectSettings.jsx.
Tests/build status: backend 31 passed/0 skipped against PostgreSQL; user
confirmed all three Phase 5.5 browser checks; real-cookie HTTP smoke test also
passed all three invariants; Node syntax passed;
frontend build passed; both .NET builds passed; migration and live row
verification passed; diff check passed.
Known issues: Plane OAuth provider configuration/manual verification, Google
OAuth credentials and exact callback configuration, global Plane
workspace/project scope. Phase 8 error-handling work is not started.
Do NOT redo: Phases 0-6.5 or Phase 7 authorization/isolation tests.
NEXT ACTION: Configure real Plane OAuth values in the backend environment,
register `http://localhost:3090/api/integrations/plane/oauth/callback`, then
manually verify connect/callback, account/workspace metadata, encrypted storage,
per-user A/B isolation, Bearer MCP calls, refresh, reconnect on revoked token,
and disconnect. Only after that may Phase 8 start.
Recommended first files/commands: read this section; inspect be/src/server.js,
be/src/applicationAuth.js, be/src/database.js; run npm test with TEST_DATABASE_URL.
```

## NEXT ACTION

Finish real Plane OAuth provider configuration and manual verification using
the Plane OAuth checklist in this audit section. Do not start Phase 8 until
provider verification is complete and recorded.

## DEBUG UPDATE — 2026-09-24

Observed sequence: `plane.oauth.callback.state_validation { valid: true }`,
then `plane.oauth.token_exchange.started`, followed by MCP catalog failures.

Root causes found:

- OAuth exchange and integration persistence had no safe structured success or
  failure diagnostics. The callback owner is `pending.userId`, and the
  existing save path is user/provider keyed in PostgreSQL; no cross-user
  fallback was introduced.
- The Docker backend `.env` pointed Plane and Discord MCP at `127.0.0.1`.
  Because the MCP processes run outside the backend container, that loopback
  address targets the backend container itself. Targets were changed to
  `host.docker.internal` while preserving the existing MCP auth headers and
  per-user execution context.
- MCP initialization, `tools/list`, RPC failures, and per-user credential
  context now emit safe development diagnostics. Credential values are never
  logged; only `userId`, auth type, and presence booleans are reported.

Changes made:

- `be/src/planeOAuth.js`: added `token_exchange.success` and
  `token_exchange.failed` logs with HTTP status and credential-presence flags.
- `be/src/server.js`: added `integration.saved` with provider, owner id, and
  credential type after the PostgreSQL save completes.
- `be/src/mcpClient.js` and `be/src/toolRegistry.js`: added handshake/RPC and
  per-user context diagnostics.
- `be/.env`: changed MCP and Discord internal targets to
  `host.docker.internal` for the Docker backend.

Verification status:

- Source/config inspection: PASS for Plane MCP `:3003/mcp`, Discord MCP
  `:3002/mcp`, and the C# server bindings.
- Existing runtime logs show prior successful `initialize` and `tools/list`
  requests for both C# MCP services, but Docker runtime state could not be
  queried from this sandbox.
- `npm test`: BLOCKED by the environment; every test process fails before test
  execution with Node `EPERM` while resolving `C:\Users\pc`.
- Live OAuth -> PostgreSQL -> MCP tool-call verification: PENDING restart of
  the backend/MCP services with the updated `.env`.

## NETWORK VERIFICATION — 2026-09-24

The selected topology is host mode: Node backend on `127.0.0.1:3091`, Plane
MCP on `0.0.0.0:3003`, and Discord MCP on `0.0.0.0:3002`. The backend MCP
targets and Discord internal URLs are therefore `127.0.0.1`, not
`host.docker.internal`.

- Plane source already bound `0.0.0.0:{McpPort}`; no source bind change was
  needed. The running process listened on `0.0.0.0:3003`.
- Discord source already bound `0.0.0.0:3002`; the issue was that the process
  was not running. It was started using the existing User Secrets.
- Host TCP checks before startup: Plane `127.0.0.1:3003` reachable; Discord
  `127.0.0.1:3002` refused. `host.docker.internal` was not reachable from the
  host backend topology.
- After startup, both MCP servers completed `initialize` with HTTP 200,
  `notifications/initialized` with HTTP 202, and `tools/list` with HTTP 200.
  Plane returned 5 tools; Discord returned 1 tool.
- No OAuth, per-user credential, or PostgreSQL architecture was changed in
  this network fix.

## MCP TRANSPORT VERIFICATION — 2026-09-24

Both C# servers return Streamable HTTP responses as SSE:

- HTTP status: `200`
- Content-Type: `text/event-stream`
- Protocol response: `2025-06-18`
- Plane server: `PlaneMCPServer 1.0.0.0`
- Discord server: `DiscordMCPServer 1.0.0.0`

The Node client had no MCP SDK dependency and was using a custom parser in
`be/src/mcpClient.js`. Its SSE path concatenated all `data:` lines before one
`JSON.parse`, which caused `SyntaxError` when a response contained more than
one event. The client now parses SSE event blocks independently, advertises
`MCP-Protocol-Version: 2025-06-18`, and logs safe status/content-type/header
metadata plus a redacted 500-character response preview in development.

Verification after the transport change:

- Discord initialize: HTTP 200; tools/list: HTTP 200; 1 tool discovered.
- Plane initialize: HTTP 200; tools/list: HTTP 200; 5 tools discovered.
- Backend restarted successfully on `127.0.0.1:3091` with the updated client.
- No OAuth, PostgreSQL, per-user isolation, or MCP tool implementation was
  changed.

## PHASE 8–9 COMPLETION UPDATE — 2026-09-24

Phase 8 Error Handling and Phase 9 Logging/Observability are implemented at the
shared backend boundary.

- Client-visible errors now use safe stable messages for authentication,
  expired sessions, missing integrations, rejected/forbidden provider access,
  MCP availability/errors, and database failures. Raw provider/database/MCP
  error text is not returned to the browser.
- API completion logs include `requestId`, method, path without query string,
  authenticated `userId` when available, status, and duration.
- MCP tool completion/failure logs include request/user/server/tool,
  success/failure, external HTTP status when available, and duration.
- Existing OAuth/MCP diagnostics remain redacted; access tokens, refresh
  tokens, API keys, authorization headers, and secrets are not logged.
- Phase 10 audit found no global user Plane/Discord credential fallback. The
  Plane API key header is only emitted from the request-scoped execution
  context; the Discord bot token remains an application credential owned by
  the Discord MCP service.

Verification:

- Backend tests: 30 passed, 0 failed, 1 PostgreSQL test skipped because
  `TEST_DATABASE_URL` was not configured.
- Plane MCP build: passed, 0 warnings/errors.
- Discord MCP build: passed, 0 warnings/errors.
- MCP transport: Plane and Discord initialize/tools-list verified over SSE.
- Phase 8: DONE.
- Phase 9: DONE.
- Phase 10 credential audit: DONE; `.env.example` and documentation remain
  subject to the final Phase 11 diff/secrets review.
- Phase 11: IN PROGRESS; final repository diff review and live per-user tool
  calls remain.

## CURRENT HANDOFF — 2026-09-24

Phase 0–7, Phase 8 Error Handling, and Phase 9 Logging/Observability are
complete. Phase 10's legacy-credential audit is complete. Phase 11 remains
open only for final diff hygiene and live provider/user acceptance checks.

Latest verification: backend `npm test` passed 30 tests with 1 PostgreSQL
test skipped because `TEST_DATABASE_URL` was not set; both .NET MCP projects
built with 0 warnings/errors; frontend production build passed with existing
chunk/direct-eval warnings; Plane and Discord MCP transport initialize and
tools/list passed over SSE.

Remaining acceptance work:

1. Run one real Plane OAuth connect for User A and one for User B, verify
   encrypted PostgreSQL rows and Bearer calls remain user-scoped.
2. Run one real Discord OAuth/destination flow and one Discord tool call.
3. Run the final diff/secrets review and remove only build/runtime artifacts
   that are confirmed generated and in scope; do not overwrite unrelated user
   changes.

## PHASE 11 REVIEW UPDATE — 2026-09-24

Completed the first final-review remediation slice:

- MCP catalog and MCP test routes now return stable sanitized error codes and
  messages instead of raw internal/provider errors.
- Streaming chat error events now use the same sanitized error mapping as
  ordinary API responses.
- Generic MCP tool failures no longer return raw provider/MCP exception text to
  the model or browser.
- Plane MCP request/response logs now record payload/body lengths only; full
  work-item payloads and response bodies are not logged.

Verification after this slice:

- Plane MCP source change requires a fresh .NET build.
- Backend tests remain blocked before execution by Node `EPERM` resolving
  `C:\\Users\\pc` in this environment; no assertion failures were reached.
- Frontend production build: PASS.
- Plane and Discord .NET builds: PASS before the latest Plane logging edit;
  rerun after the edit before marking this review slice complete.
- `git diff --check`: PASS before the latest edit; rerun after the edit.

Security status: no new unresolved identity, ownership, credential exposure, or
MCP trust finding was introduced. Phase 11 remains open for rerun verification,
final diff/secrets review, and real Plane/Discord provider acceptance checks.

NEXT ACTION: rerun backend tests with an approved environment workaround if
available, rebuild both MCP projects, run diff/secrets checks, then record the
remaining provider-credential blocker and final handoff. Do not mark the
project DONE until real provider acceptance or an explicit deployment waiver is
recorded.

## PHASE 11 CHECKPOINT — 2026-09-24

The safe-error and logging remediation is complete and verified:

- Backend `npm test`: 30 passed, 0 failed, 1 skipped because
  `TEST_DATABASE_URL` was not configured. The run required an environment
  workaround because the restricted sandbox produced Node `EPERM` before test
  execution.
- Frontend `npm run build`: PASS; existing chunk/direct-eval warnings only.
- Plane MCP `dotnet build --no-restore` to isolated output: PASS, 0 warnings,
  0 errors. The normal output was locked by the running Plane MCP process.
- Discord MCP `dotnet build --no-restore`: PASS, 0 warnings, 0 errors.
- `git diff --check`: PASS.
- Changed backend syntax was reviewed; direct sandbox `node --check` is subject
  to the same Node `EPERM` path-resolution issue, while the full backend test
  run parsed and executed all changed modules successfully.

Review findings fixed:

- Raw MCP catalog/test errors are now sanitized before browser responses.
- Streaming chat errors use stable safe messages rather than raw exceptions.
- Generic MCP tool failures no longer return provider exception text to the
  model.
- Plane MCP logs no longer include full request payloads or response bodies;
  only lengths and safe request metadata are logged.

Secrets review:

- No configured secret values exist in `HEAD:be/.env`; the working-tree
  `be/.env` contains local runtime configuration and must not be committed.
- No Plane or Discord credential was printed by the review commands.
- MCP/Plane/Discord source logs expose presence/type metadata only, not secret
  values.

Phase 11 remains OPEN. Plane OAuth A/B acceptance is now recorded as DONE by
user confirmation. Real Discord OAuth/destination/tool acceptance is SKIPPED
and remains pending. Do not mark the project DONE.

## LAST SESSION HANDOFF

```text
Date: 2026-09-24
Current Phase: Phase 11 — Full Code Review, implementation review slice complete;
external provider acceptance remains pending.
Completed this session: reviewed authentication/authorization/MCP/secrets
boundaries; sanitized MCP catalog/test and streaming errors; removed generic raw
MCP exception propagation; removed full Plane payload/response logging; reran
backend tests and frontend/.NET builds.
Verification: backend 30 passed, 1 PostgreSQL test skipped without
TEST_DATABASE_URL; frontend build passed; Plane isolated build passed with 0
warnings/errors; Discord build passed with 0 warnings/errors; diff check passed.
Important security invariants remain: verified project session -> req.user.id;
no frontend/LLM identity authority; per-user encrypted integrations; no global
Plane fallback; Discord bot token is service-level only; MCP context is
backend-injected and internal-token protected.
Working-tree caution: be/.env contains local runtime values added by prior
work; HEAD does not contain configured secrets. Do not commit be/.env.
Known blockers: manual Plane OAuth A/B connect/refresh/revoke/disconnect and
manual Discord OAuth/destination/tool acceptance require provider/browser
access; Discord OAuth credentials are not configured locally. PostgreSQL live
verification is already recorded as passed in the authoritative audit, but this
session's ordinary test run skipped the opt-in DB test because TEST_DATABASE_URL
was unset.
Do NOT redo: Phases 0-10 or the completed authorization/isolation work.
NEXT ACTION: obtain/confirm the real Plane and Discord provider test setup,
perform the acceptance checklist with two authenticated users, inspect only
redacted/safe outputs, then review the final git diff including generated
artifacts and update Phase 11. The project must remain not-DONE until those
checks or an explicit documented waiver are complete.
```

## PHASE 11 ACCEPTANCE RUNBOOK — 2026-09-24

### Pending checklist

- [x] Plane OAuth User A connect/callback and safe account/workspace metadata.
- [x] Plane OAuth User B connect/callback with isolated encrypted credentials.
- [x] Plane A/B MCP calls use matching Bearer credentials and never cross users.
- [x] Plane refresh, revoked-token reconnect error, and disconnect.
- [ ] Discord OAuth/install for User A and User B. **SKIPPED**.
- [ ] Discord per-user guild/channel destination validation and persistence.
      **SKIPPED**.
- [ ] Discord real tool call for each user reaches only that user's destination.
      **SKIPPED**.
- [x] Backend/frontend/MCP builds, syntax checks, tests, diff check, and source
      secret review completed for the current code.

### Real Plane OAuth A/B manual test

Prerequisites: configure the real Plane OAuth client values in the local
untracked backend environment; register the exact callback
`http://localhost:3090/api/integrations/plane/oauth/callback`; start the
backend, frontend, PostgreSQL, and MCP services; use two isolated browser
profiles and two distinct Plane accounts.

1. In profile A, sign in to the project and record only the project user id
   from `/api/me` (never a token). Open Settings and select Connect Plane.
2. Complete Plane authorization. Confirm the callback returns to Settings and
   shows only safe account/workspace metadata and `credentialType=oauth`.
3. Inspect browser Network/Application panels: no access token, refresh token,
   client secret, or provider authorization header may appear in frontend
   responses/storage.
4. Run a non-destructive, specific Plane search through project chat. Verify
   logs contain only request id, authenticated user id, auth type, and
   credential-presence flags; verify the outbound provider request uses
   `Authorization: Bearer`.
5. In profile B, repeat with a different Plane account and distinctive task.
   Confirm the result and safe Settings metadata belong to B.
6. With both profiles active, repeat A then B calls and inspect controlled
   PostgreSQL rows: owner ids differ, credentials are encrypted, and no
   plaintext token appears in logs or API responses.
7. Force/await expiry for A. Confirm a valid refresh token causes server-side
   refresh and the call still uses A's new Bearer token. Invalidate A's refresh
   token and confirm reconnect-required with no raw provider error.
8. Disconnect A. Confirm only A's integration row is removed and A's next call
   fails closed; B remains connected and operational.

Record PASS/FAIL, timestamps, user labels (A/B), safe response codes, and
redacted log evidence only. Never paste credentials into this file.

### Plane OAuth A/B result

**DONE — user-confirmed.** Plane OAuth A and B connect/callback, per-user
encrypted credential ownership, matching Bearer MCP execution, refresh/revoke
handling, and disconnect isolation were reported as PASS. No Plane credential
values are recorded here.

### Real Discord OAuth, destination, and tool manual test

Prerequisites: configure Discord OAuth client id/secret and callback, ensure
the server-side Discord bot token is present only in MCP service secrets,
install/authorize the bot in a test guild, and use two isolated project
browser profiles.

1. In profile A, select Connect Discord and complete OAuth/install. Confirm the
   callback identifies the project user through the authenticated session and
   does not accept a user id from query/body/prompt.
2. Choose a guild and text/announcement channel visible to A and accessible to
   the bot. Save it and verify only safe guild/channel metadata is returned.
3. Repeat for B with a different destination. Confirm mappings are A -> A and
   B -> B.
4. Send one explicit, non-destructive Discord test message as A and one as B.
   Verify live messages arrive only in matching channels. Model `guildId` and
   `channelId` arguments must not override trusted backend headers.
5. Remove A's destination and confirm A fails closed while B still succeeds.
   Inspect responses/logs for absence of OAuth tokens and the bot token.

## PHASE 11 SECURITY UPDATE — 2026-09-24

`be/.env` was tracked by Git and contained local runtime configuration in the
working tree. This was corrected without deleting the local file: `be/.env`
was removed from the Git index and `be/.gitignore` now ignores `.env` and
`.env.*` while allowing `.env.example`. The staged deletion must remain part of
the eventual change; do not re-add `be/.env`.

The current working tree still contains the local file for runtime use, but
`git status` must show it as ignored rather than tracked. Secret scans must use
`git ls-files` and staged diff inspection, never print secret values.

NEXT ACTION: if Discord E2E is required later, run the manual acceptance
procedure above with real provider accounts and update this waiver to PASS.
Plane OAuth A/B is complete. Phase 11 is DONE under the explicit Discord E2E
waiver; Discord was skipped, not passed.

## DEBUG UPDATE — 2026-09-24 — MCP 401 CONFIGURATION

Observed in runtime logs: both Plane and Discord return HTTP 401 during MCP
`initialize`; the backend then reports an empty-body JSON parse failure. This is
the shared MCP trust boundary, not a Discord OAuth scope or user-identity
failure.

Root cause confirmed: local `be/.env` still has `MCP_INTERNAL_TOKEN=PLACEHOLDER`.
The Plane and Discord MCP processes read their own `MCP_INTERNAL_TOKEN` from
User Secrets/environment, so the backend token does not match. The backend
process was PID 14160 and must be restarted after configuration.

Discord OAuth configuration is now reaching `/api/integrations/discord/connect`
and `/api/integrations/discord/callback` with HTTP 302 responses. A 302 alone
does not prove provider success; the redirect query must show
`integration=discord&status=connected`.

Required operator action: place the same generated 64-character token in local
ignored `be/.env` and in both MCP projects' `MCP_INTERNAL_TOKEN` User Secrets,
restart Plane MCP, Discord MCP, and backend from `MCPServer/be`, then expect
Plane/Discord `initialize` HTTP 200, initialized notification HTTP 202, and
`tools/list` HTTP 200. Do not log or paste the token into this file.

## LAST SESSION HANDOFF — 2026-09-24

```text
Current Phase: Phase 11 — Full Code Review; no new phase started.
Completed: identified all remaining acceptance items; added real Plane A/B and
Discord OAuth/destination/tool manual runbooks; confirmed generated artifacts
are pre-existing and preserved; fixed tracked local environment handling.
Security fix: be/.env is now removed from the Git index, remains present and
ignored locally, and be/.gitignore ignores .env/.env.* while allowing
.env.example. Current checks report be/.env NOT_TRACKED and IGNORED, with only
the intentional staged deletion D be/.env. Do not re-add it.
Verification: backend npm test 30 passed, 0 failed, 1 skipped without
TEST_DATABASE_URL; frontend production build passed with existing warnings;
Plane isolated .NET build passed with 0 warnings/errors; Discord .NET build
passed with 0 warnings/errors; backend node --check passed; git diff --check
passed.
Secret review: no credential values were printed. A tracked-key-name scan found
only configuration/source references; the working-tree .env is ignored and not
tracked. Generated bin/obj/runtime artifacts remain in the existing worktree;
do not bulk-delete unrelated user artifacts.
Plane OAuth A/B: DONE by user confirmation, with no credential values recorded.
Discord OAuth/destination/tool E2E: SKIPPED under explicit user waiver; not
claimed as PASS.
NEXT ACTION: none for Phase 11 under the current waiver. If the waiver is
revoked, run the Discord acceptance runbook and replace SKIPPED with actual
PASS/FAIL evidence.
```

## FINAL PHASE 11 STATUS — 2026-09-24

Phase 11: **DONE WITH EXPLICIT DISCORD E2E WAIVER**.

- Plane OAuth A/B: DONE by user confirmation; no credential values recorded.
- Discord OAuth/destination/tool E2E: SKIPPED under explicit user waiver; not
  claimed as PASS.
- Automated verification and security/diff review: PASS as recorded above.

No further Phase 11 action is required under the current waiver. If the waiver
is revoked, run the Discord acceptance runbook and replace SKIPPED with actual
PASS/FAIL evidence. This status does not claim Discord E2E was completed.
# MCP transport debug update — 2026-09-24

Root cause of the Plane/Discord MCP test `502` responses:

- `POST /api/chat/mcp/:name/test` calls `McpClient.listTools()`, which calls `initialize()` and then `rpc('initialize')`.
- The shared backend `MCP_INTERNAL_TOKEN` contained non-ASCII Unicode characters. Node `fetch()` rejected the `x-mcp-internal-token` header before sending the request: `Cannot convert argument to a ByteString because the character at index 7 has a value of 7883 which is greater than 255`.
- This affected both Plane (`127.0.0.1:3003`) and Discord (`127.0.0.1:3002`) through the shared MCP transport. TCP reachability was present; no MCP HTTP request was made during the failing call.
- The old fetch catch wrapped the exception as `MCP_SERVER_UNREACHABLE` without logging its cause. Therefore only `mcp.initialize.started` appeared; neither `mcp.rpc.failed` nor `mcp.initialize.failed` was emitted.

Shared-layer changes:

- `be/src/mcpClient.js` now logs safe transport causes, HTTP status, Content-Type, JSON parse, JSON-RPC, and MCP protocol failures without logging credentials.
- Initialization now emits `mcp.initialize.failed` and preserves the original failure classification.
- Backend and frontend MCP catalog/test responses are marked no-store to avoid stale availability state.

Validation:

- Direct backend-runtime probe reached the shared client and reproduced the Unicode header failure for both Plane and Discord. The new safe classification is `ERR_INVALID_HEADER_VALUE`; no HTTP request is sent in this case.
- Backend test suite: 30 passed, 1 PostgreSQL test skipped because `TEST_DATABASE_URL` is unset.
- The shared token must be replaced with the same ASCII-only value in the backend, Plane MCP process, and Discord MCP process before the live Plane/Discord `test` and catalog/list_tools checks can pass.

## LOCAL AUTH EXTENSION — 2026-09-24

STATUS: IMPLEMENTED; PostgreSQL live execution and browser smoke tests remain environment-dependent.

Completed:

- Added `POST /api/auth/register` and `POST /api/auth/login` with application-only credentials, normalized emails, bcrypt hashes, safe profiles, and the existing opaque `project_session`/`req.user.id` boundary.
- Google OAuth now links an existing local account by normalized email, preventing duplicate application users while preserving Google-only, local-only, and linked accounts.
- Added in-process login/register rate limiting, generic invalid-login errors, safe auth logging, and cookie serialization with HttpOnly, SameSite=Lax, and configurable Secure.
- Added the Email, Password, Sign in, OR, and Continue with Google UI with loading/error feedback and `/chat/new` redirect.
- Added tests for register/login/logout, wrong password, duplicate registration, Google/local linking, and two-user session isolation.

Verification:

- Backend `npm test`: PASS — 34 passed, 1 PostgreSQL test skipped because no test database was configured.
- Frontend `npm run build`: PASS; existing Vite dependency/chunk warnings only.
- Security review confirms no plaintext password/password hash logging or safe-profile leakage, no frontend-selected user ID, and no Google password handling.
- Fixed a runtime issue found during review: backend auth no longer relies on unavailable `res.cookie()`/`res.clearCookie()` middleware.

Remaining acceptance checks: run PostgreSQL-backed tests against an existing database migration and perform browser smoke tests for local auth, same-email Google linking, duplicate registration, wrong password, logout, and two-user session switching.

## LOGIN UI REFINEMENT — 2026-09-24

STATUS: IMPLEMENTED; browser smoke tests and PostgreSQL-backed auth checks remain pending.

Completed:

- Refined the project login screen with responsive 430px card layout, light/dark themes, accessible labels, focus/error states, password visibility toggle, remember-me state, loading state, and double-submit protection.
- Kept Google OAuth provider flow unchanged and added safe internal `returnTo` handling for local and Google sign-in.
- Added generic invalid-credential messaging and session-expired messaging without exposing provider/raw errors.
- Kept the backend registration route available while presenting the internal-access contact affordance instead of a prominent public registration CTA.

Manual checks pending: successful local login, wrong-password error, keyboard Enter submit, password toggle focus retention, double-click behavior, Google OAuth callback, logout/login again, session expiry, valid/invalid `returnTo`, mobile layout, and dark mode.

