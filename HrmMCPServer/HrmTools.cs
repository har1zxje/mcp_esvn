using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

[McpServerToolType]
public class HrmTools
{
    [McpServerTool, Description("Get department details by department ID.")]
    public static Task<string> GetDepartmentDetails(HrmApiClient api, [Description("Department ID, for example dept-product")] string departmentId, CancellationToken cancellationToken)
      => Execute(() => api.GetDepartmentDetailsAsync(ResourceId(departmentId, "department"), cancellationToken));

    [McpServerTool, Description("Get department overview by department ID, result return department detail, member count, active member count, member detail.")]
    public static Task<string> GetDepartmentOverview(HrmApiClient api, [Description("Department ID, for example dept-product")] string departmentId, CancellationToken cancellationToken)
      => Execute(() => api.GetDepartmentOverviewAsync(ResourceId(departmentId, "department"), cancellationToken));

    [McpServerTool, Description("Get one employee profile by employee ID.")]
    public static Task<string> GetEmployeeProfile(HrmApiClient api, [Description("Employee ID, for example employee-a1")] string employeeId, CancellationToken cancellationToken)
      => Execute(() => api.GetEmployeeProfileAsync(ResourceId(employeeId, "employee"), cancellationToken));

    [McpServerTool, Description("List attendance records for one employee by employee ID.")]
    public static Task<string> GetEmployeeAttendance(HrmApiClient api, [Description("Employee ID, for example employee-a1")] string employeeId, CancellationToken cancellationToken)
      => Execute(() => api.GetLearningEmployeeAttendanceAsync(ResourceId(employeeId, "employee"), cancellationToken));

    [McpServerTool, Description("List leave requests for one employee by employee ID.")]
    public static Task<string> GetEmployeeLeaveRequests(HrmApiClient api, [Description("Employee ID, for example employee-a1")] string employeeId, CancellationToken cancellationToken)
      => Execute(() => api.GetLearningEmployeeLeaveRequestsAsync(ResourceId(employeeId, "employee"), cancellationToken));

    [McpServerTool, Description("Create one pending leave request for the authenticated employee.")]
    public static Task<string> CreateLeaveRequest(HrmApiClient api, [Description("Leave type ID")] string leaveTypeId, [Description("Start date, YYYY-MM-DD")] string startDate, [Description("End date, YYYY-MM-DD")] string endDate, [Description("Positive leave days")] decimal requestedDays, [Description("Optional reason")] string? reason, CancellationToken cancellationToken)
      => Execute(() => api.CreateLearningLeaveRequestAsync(ResourceId(leaveTypeId, "leave type"), Date(startDate), Date(endDate), PositiveDays(requestedDays), OptionalReason(reason), cancellationToken));

    [McpServerTool, Description("List active HRM projects.")]
    public static Task<string> ListProjects(HrmApiClient api, CancellationToken cancellationToken)
      => Execute(() => api.ListLearningProjectsAsync(cancellationToken));

    [McpServerTool, Description("List tasks for one active HRM project.")]
    public static Task<string> ListProjectTasks(HrmApiClient api, [Description("Project ID")] string projectId, CancellationToken cancellationToken)
      => Execute(() => api.ListLearningProjectTasksAsync(ResourceId(projectId, "project"), cancellationToken));

    [McpServerTool(Name = "update_task_status"), Description("Update one HRM task status through a valid transition.")]
    public static Task<string> UpdateLearningTaskStatus(HrmApiClient api, [Description("Task ID")] string taskId, [Description("New status: in_progress, blocked, done, or cancelled")] string status, CancellationToken cancellationToken)
      => Execute(() => api.UpdateLearningTaskStatusAsync(ResourceId(taskId, "task"), Status(status), cancellationToken));

    [McpServerTool, Description("List employee profiles.")]
    public static Task<string> ListEmployees(HrmApiClient api, CancellationToken cancellationToken)
      => Execute(() => api.ListEmployeesAsync(cancellationToken));

    [McpServerTool, Description("Search employee profiles by name.")]
    public static Task<string> SearchEmployees(HrmApiClient api, [Description("Employee name or name fragment")] string query, CancellationToken cancellationToken)
      => Execute(() => api.SearchEmployeesAsync(RequiredText(query, "search query"), cancellationToken));

    [McpServerTool, Description("List HRM departments.")]
    public static Task<string> ListDepartments(HrmApiClient api, CancellationToken cancellationToken)
      => Execute(() => api.ListDepartmentsAsync(cancellationToken));

    [McpServerTool(Name = "get_my_profile"), Description("Get the authenticated user's own HRM employee profile. Use this for requests about my profile, my information, or information about myself.")]
    public static Task<string> GetMyProfile(HrmApiClient api, CancellationToken cancellationToken) => Execute(() => api.GetAsync("/internal/v1/me/profile", cancellationToken));

    public static Task<string> GetMyTeam(HrmApiClient api, CancellationToken cancellationToken) => Execute(() => api.GetAsync("/internal/v1/me/team", cancellationToken));

    public static Task<string> FindEmployee(HrmApiClient api, [Description("Name fragment to search for")] string query, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/employees/search?query={Uri.EscapeDataString(query ?? string.Empty)}", cancellationToken));

    public static Task<string> GetEmployee(HrmApiClient api, [Description("Employee resource ID returned by an HRM search or team result")] string employeeId, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/employees/{ResourceId(employeeId, "employee")}", cancellationToken));

    public static Task<string> ListLegacyDepartments(HrmApiClient api, CancellationToken cancellationToken) => Execute(() => api.GetAsync("/internal/v1/departments", cancellationToken));

    [McpServerTool, Description("List employee profiles in one department by department ID.")]
    public static Task<string> GetDepartmentMembers(HrmApiClient api, [Description("Department ID, for example dept-product")] string departmentId, CancellationToken cancellationToken)
      => Execute(() => api.GetLearningDepartmentMembersAsync(ResourceId(departmentId, "department"), cancellationToken));

    public static Task<string> GetLegacyDepartmentMembers(HrmApiClient api, [Description("Department resource ID")] string departmentId, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/departments/{ResourceId(departmentId, "department")}/employees", cancellationToken));

    public static Task<string> GetMyAttendance(HrmApiClient api, [Description("Start date, YYYY-MM-DD")] string from, [Description("End date, YYYY-MM-DD")] string to, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/me/attendance?from={Date(from)}&to={Date(to)}", cancellationToken));

    public static Task<string> GetTeamAttendance(HrmApiClient api, [Description("Start date, YYYY-MM-DD")] string from, [Description("End date, YYYY-MM-DD")] string to, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/me/team/attendance?from={Date(from)}&to={Date(to)}", cancellationToken));

    public static Task<string> GetMyAttendanceSummary(HrmApiClient api, [Description("Start date, YYYY-MM-DD")] string from, [Description("End date, YYYY-MM-DD")] string to, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/me/attendance/summary?from={Date(from)}&to={Date(to)}", cancellationToken));

    public static Task<string> GetTeamAttendanceSummary(HrmApiClient api, [Description("Start date, YYYY-MM-DD")] string from, [Description("End date, YYYY-MM-DD")] string to, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/me/team/attendance/summary?from={Date(from)}&to={Date(to)}", cancellationToken));

    public static Task<string> GetMyLeaveBalance(HrmApiClient api, [Description("Calendar year, from 2000 through 2100")] int year, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/me/leave-balances?year={Year(year)}", cancellationToken));

    public static Task<string> GetMyLeaveRequests(HrmApiClient api, CancellationToken cancellationToken) => Execute(() => api.GetAsync("/internal/v1/me/leave-requests", cancellationToken));

    public static Task<string> GetPendingLeaveApprovals(HrmApiClient api, CancellationToken cancellationToken) => Execute(() => api.GetAsync("/internal/v1/me/team/pending-leave-requests", cancellationToken));

    public static Task<string> PreviewMyLeaveRequest(HrmApiClient api, [Description("Company-local leave type code returned by get_my_leave_balance, for example ANNUAL")] string leaveTypeCode, [Description("Start date, YYYY-MM-DD")] string startDate, [Description("End date, YYYY-MM-DD")] string endDate, [Description("Explicit positive leave days; do not infer this from calendar dates")] decimal requestedDays, [Description("Optional reason, up to 1000 characters")] string? reason, CancellationToken cancellationToken)
      => Execute(() => api.PostAsync("/internal/v1/me/leave-request-preview", new { leaveTypeCode = ResourceId(leaveTypeCode, "leave type code"), startDate = Date(startDate), endDate = Date(endDate), requestedDays = PositiveDays(requestedDays), reason = OptionalReason(reason) }, cancellationToken));

    public static Task<string> GetMyTasks(HrmApiClient api, [Description("Optional status: todo, in_progress, blocked, done, or cancelled")] string? status, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/me/tasks{StatusQuery(status)}", cancellationToken));

    public static Task<string> GetTeamTasks(HrmApiClient api, [Description("Optional status: todo, in_progress, blocked, done, or cancelled")] string? status, CancellationToken cancellationToken) => Execute(() => api.GetAsync($"/internal/v1/me/team/tasks{StatusQuery(status)}", cancellationToken));

    public static Task<string> CreateTask(HrmApiClient api, [Description("Project resource ID")] string projectId, [Description("Task title")] string title, [Description("Optional task description")] string? description, [Description("Optional priority: low, medium, high")] string? priority, [Description("Optional due date, YYYY-MM-DD")] string? dueDate, CancellationToken cancellationToken) => Execute(() => api.PostAsync($"/internal/v1/projects/{ResourceId(projectId, "project")}/tasks", new { title, description, priority, dueDate }, cancellationToken));

    public static Task<string> AssignTask(HrmApiClient api, [Description("Task resource ID")] string taskId, [Description("Employee resource ID")] string employeeId, CancellationToken cancellationToken) => Execute(() => api.PostAsync($"/internal/v1/tasks/{ResourceId(taskId, "task")}/assignments", new { employeeId = ResourceId(employeeId, "employee") }, cancellationToken));

    public static Task<string> UpdateTaskStatus(HrmApiClient api, [Description("Task resource ID")] string taskId, [Description("New status: in_progress, blocked, done, or cancelled")] string status, CancellationToken cancellationToken) => Execute(() => api.PostAsync($"/internal/v1/tasks/{ResourceId(taskId, "task")}/status", new { status }, cancellationToken));

    private static async Task<string> Execute(Func<Task<string>> operation)
    {
        try { return await operation(); }
        catch (HrmMcpException error) { return JsonSerializer.Serialize(new { error = new { code = error.Code, message = HrmApiClient.SafeMessage(error.Code) } }); }
    }
    private static string ResourceId(string value, string kind)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 100 || !value.All(c => char.IsLetterOrDigit(c) || c is '-' or '_')) throw new HrmMcpException("HRM_VALIDATION_FAILED", $"A valid {kind} ID is required.");
        return Uri.EscapeDataString(value);
    }
    private static string RequiredText(string value, string kind)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length > 100) throw new HrmMcpException("HRM_VALIDATION_FAILED", $"A valid {kind} is required.");
        return value.Trim();
    }
    private static string Status(string value)
    {
        var status = RequiredText(value, "task status");
        if (status is not ("in_progress" or "blocked" or "done" or "cancelled")) throw new HrmMcpException("HRM_VALIDATION_FAILED", "A valid task status is required.");
        return status;
    }
    private static string Date(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length != 10) throw new HrmMcpException("HRM_VALIDATION_FAILED", "A valid date is required.");
        return Uri.EscapeDataString(value);
    }
    private static int Year(int value)
    {
        if (value is < 2000 or > 2100) throw new HrmMcpException("HRM_VALIDATION_FAILED", "A valid leave year is required.");
        return value;
    }
    private static decimal PositiveDays(decimal value)
    {
        if (value <= 0) throw new HrmMcpException("HRM_VALIDATION_FAILED", "Requested leave days must be positive.");
        return value;
    }
    private static string? OptionalReason(string? value)
    {
        if (value is null) return null;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 1000) throw new HrmMcpException("HRM_VALIDATION_FAILED", "A valid reason is required.");
        return value.Trim();
    }
    private static string StatusQuery(string? status) => string.IsNullOrWhiteSpace(status) ? string.Empty : $"?status={Uri.EscapeDataString(status)}";
}
