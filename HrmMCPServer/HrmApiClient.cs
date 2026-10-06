using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

public sealed class HrmApiClient
{
    private static readonly Regex ContextId = new("^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$", RegexOptions.Compiled);
    private static readonly Regex RequestId = new("^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", RegexOptions.Compiled);
    private readonly IHttpClientFactory _factory;
    private readonly string _baseUrl;
    private readonly string _token;
    private readonly IHttpContextAccessor _context;
    private readonly ILogger<HrmApiClient> _logger;
    private readonly bool _learningMode;

    public HrmApiClient(IHttpClientFactory factory, string baseUrl, string token, IHttpContextAccessor context, ILogger<HrmApiClient> logger, bool learningMode = false) => (_factory, _baseUrl, _token, _context, _logger, _learningMode) = (factory, baseUrl.TrimEnd('/'), token, context, logger, learningMode);
    public Task<string> GetAsync(string path, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, path, null, cancellationToken);
    public Task<string> GetEmployeeProfileAsync(string employeeId, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/employees/{employeeId}", null, cancellationToken);
    public Task<string> GetLearningEmployeeAttendanceAsync(string employeeId, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/employees/{employeeId}/attendance", null, cancellationToken);
    public Task<string> GetLearningEmployeeLeaveRequestsAsync(string employeeId, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/employees/{employeeId}/leave-requests", null, cancellationToken);
    public Task<string> CreateLearningLeaveRequestAsync(string leaveTypeId, string startDate, string endDate, decimal requestedDays, string? reason, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Post, "/api/leave-requests", new { leaveTypeId, startDate, endDate, requestedDays, reason }, cancellationToken);
    public Task<string> ListLearningProjectsAsync(CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, "/api/projects", null, cancellationToken);
    public Task<string> ListLearningProjectTasksAsync(string projectId, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/projects/{Uri.EscapeDataString(projectId)}/tasks", null, cancellationToken);
    public Task<string> UpdateLearningTaskStatusAsync(string taskId, string status, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Patch, $"/api/tasks/{Uri.EscapeDataString(taskId)}", new { status }, cancellationToken);
    public Task<string> ListEmployeesAsync(CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, "/api/employees", null, cancellationToken);
    public Task<string> SearchEmployeesAsync(string query, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/employees?search={Uri.EscapeDataString(query)}", null, cancellationToken);
    public Task<string> ListDepartmentsAsync(CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, "/api/departments", null, cancellationToken);
    public Task<string> GetLearningDepartmentMembersAsync(string departmentId, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/departments/{departmentId}/employees", null, cancellationToken);
    public Task<string> PostAsync(string path, object body, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Post, path, body, cancellationToken);
    public Task<string> PatchAsync(string path, object body, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Patch, path, body, cancellationToken);
    public Task<string> GetDepartmentDetailsAsync(string departmentId, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/departments/{departmentId}", null, cancellationToken);
    public Task<string> GetDepartmentOverviewAsync(string departmentId, CancellationToken cancellationToken = default) => SendAsync(HttpMethod.Get, $"/api/departments/{departmentId}/overview", null, cancellationToken);



    private async Task<string> SendAsync(HttpMethod method, string path, object? body, CancellationToken cancellationToken)
    {
        var isLearningRoute = _learningMode && (path == "/api/employees" || path.StartsWith("/api/employees?", StringComparison.Ordinal) || path.StartsWith("/api/employees/", StringComparison.Ordinal) || path == "/api/departments" || path.StartsWith("/api/departments/", StringComparison.Ordinal) || path == "/api/leave-requests" || path == "/api/projects" || path.StartsWith("/api/projects/", StringComparison.Ordinal) || path.StartsWith("/api/tasks/", StringComparison.Ordinal));
        if (!path.StartsWith("/internal/v1/", StringComparison.Ordinal) && !isLearningRoute) throw new HrmMcpException("HRM_UNAVAILABLE", "HRM service is unavailable.");
        var isLearningProfile = _learningMode && path.StartsWith("/api/employees/", StringComparison.Ordinal);
        // MCP supplies only the authenticated user and a correlation ID.  The
        // HRM API resolves employeeId and companyId from hrm_identity_links.
        var trusted = TrustedContext();
        var uri = new Uri($"{_baseUrl}{path}");
        using var request = new HttpRequestMessage(method, uri);
        request.Headers.Add("X-HRM-Internal-Token", _token);
        request.Headers.Add("X-HRM-Contract-Version", "1");
        if (trusted is not null)
        {
            request.Headers.Add("X-Actor-User-Id", trusted.UserId);
            request.Headers.Add("X-Request-Id", trusted.RequestId);
        }
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        try
        {
            using var response = await _factory.CreateClient("hrm").SendAsync(request, cancellationToken);
            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                if (!HasDataEnvelope(content)) throw new HrmMcpException("HRM_API_UNREACHABLE", "HRM API returned an invalid response.");
                _logger.LogInformation("HRM API completed {Operation} {Path} {RequestId} status {HttpStatus}", method, uri.AbsolutePath, trusted.RequestId, (int)response.StatusCode);
                return content;
            }
            var code = ErrorCode(response.StatusCode, content, isLearningProfile);
            _logger.LogWarning("HRM API failed {Operation} {Path} {RequestId} status {HttpStatus} code {ErrorCode}", method, uri.AbsolutePath, trusted.RequestId, (int)response.StatusCode, code);
            throw new HrmMcpException(code, SafeMessage(code));
        }
        catch (HrmMcpException) { throw; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("HRM API timed out {Operation} {Path} {RequestId}", method, uri.AbsolutePath, trusted.RequestId);
            throw new HrmMcpException("HRM_API_UNREACHABLE", "HRM API is unavailable.");
        }
        catch (Exception)
        {
            _logger.LogWarning("HRM API unavailable {Operation} {Path} {RequestId}", method, uri.AbsolutePath, trusted.RequestId);
            throw new HrmMcpException("HRM_API_UNREACHABLE", "HRM API is unavailable.");
        }
    }

    private TrustedHrmContext TrustedContext()
    {
        var headers = _context.HttpContext?.Request.Headers;
        var userId = headers?["X-MCP-User-Id"].ToString();
        var requestId = headers?["X-MCP-Request-Id"].ToString();
        if (!ValidId(userId) || string.IsNullOrWhiteSpace(requestId) || !RequestId.IsMatch(requestId)) throw new HrmMcpException("HRM_UNAUTHENTICATED", "Authenticated HRM context is required.");
        return new TrustedHrmContext(userId!, requestId!);
    }

    private static bool ValidId(string? value) => value is not null && ContextId.IsMatch(value);
    private static bool HasDataEnvelope(string content) { try { using var doc = JsonDocument.Parse(content); return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("data", out _); } catch { return false; } }
    private static string ErrorCode(HttpStatusCode status, string content, bool isLearningProfile)
    {
        try
        {
            using var document = JsonDocument.Parse(content);
            if (document.RootElement.TryGetProperty("error", out var error)
                && error.TryGetProperty("code", out var code)
                && code.ValueKind == JsonValueKind.String
                && IsSafeErrorCode(code.GetString())) return code.GetString()!;
        }
        catch (JsonException) { }
        return status switch { HttpStatusCode.Unauthorized => "HRM_UNAUTHENTICATED", HttpStatusCode.Forbidden => "HRM_FORBIDDEN", HttpStatusCode.NotFound when isLearningProfile => "EMPLOYEE_NOT_FOUND", HttpStatusCode.NotFound => "HRM_NOT_FOUND", HttpStatusCode.BadRequest => "HRM_VALIDATION_FAILED", HttpStatusCode.Conflict => "HRM_CONFLICT", _ => "HRM_API_UNREACHABLE" };
    }
    private static bool IsSafeErrorCode(string? code) => code is "HRM_UNAUTHENTICATED" or "HRM_IDENTITY_NOT_LINKED" or "HRM_COMPANY_REQUIRED" or "HRM_COMPANY_FORBIDDEN" or "HRM_RESOURCE_NOT_FOUND" or "HRM_FORBIDDEN" or "HRM_NOT_FOUND" or "HRM_VALIDATION_FAILED" or "HRM_CONFLICT";
    public static string SafeMessage(string code) => code switch { "HRM_UNAUTHENTICATED" => "HRM request is not authorized.", "HRM_IDENTITY_NOT_LINKED" => "HRM identity is not linked to this account.", "HRM_COMPANY_REQUIRED" => "An HRM company context is required.", "HRM_COMPANY_FORBIDDEN" => "The selected HRM company is not available.", "HRM_RESOURCE_NOT_FOUND" => "The requested HRM resource was not found.", "HRM_FORBIDDEN" => "You do not have permission to perform this action.", "EMPLOYEE_NOT_FOUND" => "Employee was not found.", "HRM_NOT_FOUND" => "The requested HRM resource was not found.", "HRM_VALIDATION_FAILED" => "HRM request is invalid.", "HRM_CONFLICT" => "HRM request conflicts with the current state.", "HRM_API_UNREACHABLE" => "HRM API is unavailable.", _ => "HRM service is unavailable." };
    private sealed record TrustedHrmContext(string UserId, string RequestId);
}

public sealed class HrmMcpException : Exception
{
    public string Code { get; }
    public HrmMcpException(string code, string message) : base(message) => Code = code;
}
