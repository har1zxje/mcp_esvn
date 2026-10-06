# HRM Server

`hrm-server` is the only service that owns HRM PostgreSQL data. The browser,
Chat Backend, and HrmMCPServer must never read the database or legacy JSON
fixture files directly.

## Database lifecycle

Set private `DATABASE_URL` and `HRM_INTERNAL_TOKEN` in `.env` (or in the
process environment), then run the versioned migration and idempotent
development seed. The npm start scripts load the project-local `.env` file:

```text
npm run db:migrate
npm run db:seed
npm start
```

`migrations/001_initial_hrm.sql` creates the Phase 2 foundation: companies,
departments, positions, employees, identity/RBAC tables, audit logs, tenant
indexes, foreign keys, and constraints. `data/*.json` is historical fixture
material only; no runtime module imports it.

The idempotent development seed includes two realistic demo organizations,
nine departments, twelve positions, fourteen employees, explicit chat-user
identity links, and baseline role / permission assignments. It also includes
seven attendance records for capability testing.

## Internal API (Phase 2)

The protected surface is `/internal/v1`, with `X-HRM-Internal-Token`,
`X-HRM-Contract-Version: 1`, `X-Actor-User-Id`, and `X-Request-Id` required
on every business request. The server resolves employee, company, roles, and
permissions through `hrm_identity_links` and the HRM database; it never trusts
role, permission, employee, or company fields from a request body or caller
controlled company header.
Errors use the safe v1 envelope from
[`../HRM_INTERNAL_HTTP_CONTRACT.md`](../HRM_INTERNAL_HTTP_CONTRACT.md).

Company/employee writes are recorded transactionally in `audit_logs`; company
deletion is a logical archive so audit history remains referentially valid.
Phase 6 adds read-only attendance capabilities, each with a required inclusive
`from`/`to` ISO-date range of at most 366 days:

- `GET /internal/v1/me/attendance` and `/summary` require
  `attendance.read.self` and always use the mapped actor's employee ID.
- `GET /internal/v1/me/team/attendance` and `/summary` require
  `attendance.read.team` and only query the mapped actor's department.

Attendance reads intentionally create no audit records because this phase has
no attendance writes. Until HrmMCPServer is refactored in Phase 8, its legacy
`/api/*` requests fail closed rather than using the retired JSON mock API.

Phase 7 adds company-scoped `projects`, `project_members`, `tasks`,
`task_assignments`, and `task_comments`. The currently implemented task API is:

- `POST /internal/v1/projects` and `POST /internal/v1/projects/{projectId}/tasks`
  require `task.manage.team`.
- `POST /internal/v1/tasks/{taskId}/assignments` and `PATCH /internal/v1/tasks/{taskId}`
  require `task.manage.team`; a manager can only manage an unassigned task they
  created or an assigned task in their department.
- `GET /internal/v1/me/tasks` requires `task.read.self`; `GET /internal/v1/me/team/tasks`
  requires `task.read.team` and is limited to the actor's department.
- `POST /internal/v1/tasks/{taskId}/status` requires `task.update.self` for an
  assignment owned by the actor, or the manager capability for a team task.
  Status transitions are validated and terminal states cannot be reopened.

Every project/task write is transactional and writes an `audit_logs` entry.

## Tests

```text
npm test
```

The PostgreSQL integration tests are skipped unless `TEST_DATABASE_URL` is
set. They verify migration-backed company/employee CRUD, identity/RBAC and
tenant boundaries, leave workflow, and self/team attendance isolation.
They also verify the manager create → assign → employee update-status → manager
team-view task workflow and its audit trail.

Use a dedicated disposable database only; never point this variable at the
development or shared HRM database:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://test_user:test_password@127.0.0.1:5432/hrm_test'
npm run db:migrate
npm test
```

Before migration 006, review duplicate `hrm_identity_links.chat_user_id` rows.
The migration fails safely with an actionable error instead of selecting or
deleting an identity mapping.
