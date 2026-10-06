# HRM MCP Server

MCP-only adapter between the Chat Backend and HRM Server. It owns no HRM data,
never reads PostgreSQL or JSON fixtures. HRM learning mode calls only
`GET /api/employees/:id`; legacy internal routes remain separate.

For the learning slice, start it with `./run-learning.ps1`. The script loads the
private tokens from the project-local HRM and chat-backend `.env` files and sets
`MCP_ENABLED_SERVERS=hrm`. Requests still require `X-MCP-Internal-Token`, but
the profile tool does not require multi-company/RBAC context headers.

The learning catalog exposes `get_employee_profile(employeeId)`,
`search_employees(query)`, `list_employees()`, `list_departments()`, and
`get_department_members(departmentId)`, and
`get_employee_attendance(employeeId)`, and
`get_employee_leave_requests(employeeId)`, `list_projects()`, and
`list_project_tasks(projectId)`, and `update_task_status(taskId, status)`.
The HRM server remains the final authority for data access and business rules.

Run the dependency-free adapter contract verification with:

```text
dotnet run --project ../HrmMCPServer.Tests
```
