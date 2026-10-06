using System.Text;
using System.Text.Json;
using System.Collections.Generic;
using System.Net.Http.Headers;

public class PlaneAPIServices
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ILogger<PlaneAPIServices> _logger;

    public PlaneAPIServices(
        IHttpClientFactory httpClientFactory, 
        string baseUrl, 
        IHttpContextAccessor httpContextAccessor,
        ILogger<PlaneAPIServices> logger)
    {
        _httpClient = httpClientFactory.CreateClient();
        _baseUrl = baseUrl.TrimEnd('/');
        _httpContextAccessor = httpContextAccessor;
        _logger = logger;
    } 

    public Task<string> ListProjectsAsync()
    {
        var scope = RequireScope(requireProject: false);
        return GetPlaneJsonAsync($"{_baseUrl}/api/v1/workspaces/{Uri.EscapeDataString(scope.Workspace)}/projects/?per_page=100", "list_projects");
    }

    public sealed class PlaneApiException : Exception
    {
        public PlaneApiException(string code, string message, int? statusCode = null, string? requiredScope = null, Exception? innerException = null)
            : base(message, innerException)
        {
            Code = code;
            StatusCode = statusCode;
            RequiredScope = requiredScope;
        }

        public string Code { get; }
        public int? StatusCode { get; }
        public string? RequiredScope { get; }
    }

    public Task<string> GetAuthenticatedUserAsync()
        => GetPlaneJsonAsync($"{_baseUrl}/api/v1/users/me/", "get_authenticated_user");

    public Task<string> ListProjectStatesAsync(string? projectId = null)
    {
        var scope = RequireScope();
        var resolvedProjectId = ResolveProject(scope, projectId);
        return GetPlaneJsonAsync(
            $"{_baseUrl}/api/v1/workspaces/{Uri.EscapeDataString(scope.Workspace)}/projects/{Uri.EscapeDataString(resolvedProjectId)}/states/?per_page=100",
            "list_project_states");
    }

    public Task<string> ListProjectMembersAsync(string? projectId = null)
    {
        var scope = RequireScope();
        var resolvedProjectId = ResolveProject(scope, projectId);
        return GetPlaneJsonAsync(
            $"{_baseUrl}/api/v1/workspaces/{Uri.EscapeDataString(scope.Workspace)}/projects/{Uri.EscapeDataString(resolvedProjectId)}/project-members/",
            "list_project_members");
    }

    private async Task<string> GetPlaneJsonAsync(string url, string operation)
    {
        return await SendPlaneAsync(HttpMethod.Get, url, operation);
    }

    private async Task<string> SendPlaneAsync(HttpMethod method, string url, string operation, HttpContent? content = null)
    {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        SetAuthentication(request);
        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(request);
        }
        catch (Exception exception)
        {
            LogPlaneFailure(operation, url, null, "PLANE_UNAVAILABLE", null, new SafeProviderError("network", "Plane API is unreachable"), exception);
            throw new PlaneApiException("PLANE_UNAVAILABLE", "Plane API is unreachable.", null, innerException: exception);
        }
        using (response)
        {
            var responseContent = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                var code = ClassifyPlaneFailure(response.StatusCode, operation);
                var requiredScope = RequiredScopeFor(response.StatusCode, operation);
                var providerError = SanitizePlaneError(responseContent);
                LogPlaneFailure(operation, url, (int)response.StatusCode, code, requiredScope, providerError, null);
                throw new PlaneApiException(code, PublicMessageFor(code, requiredScope), (int)response.StatusCode, requiredScope);
            }
            return responseContent;
        }
    }

    public async Task<string> CreateWorkItemsAsync(
        string? name = null,
        string? descriptionHtml = null,
        string? stateId = null,
        string? priority = null,
        List<string>? assigneeIds = null,
        List<string>? labelIds = null,
        string? parentId = null,
        int? estimatePoint = null,
        string? typeId = null,
        string? moduleId = null,
        string? startDate = null,
        string? targetDate = null,
        string? externalSource = null,
        string? externalId = null,
        bool? isDraft = null)
    {
        var scope = RequireScope();
        var url = $"{_baseUrl}/api/v1/workspaces/{Uri.EscapeDataString(scope.Workspace)}/projects/{Uri.EscapeDataString(scope.ProjectId!)}/work-items/";

        var requestBody = new Dictionary<string, object?>
        {
            ["name"] = name,
        };

        if (descriptionHtml is not null)
            requestBody["description_html"] = descriptionHtml;

        if (stateId is not null)
            requestBody["state"] = stateId;

        if (priority is not null)
            requestBody["priority"] = priority;

        if (assigneeIds is not null)
            requestBody["assignees"] = assigneeIds;

        if (labelIds is not null)
            requestBody["labels"] = labelIds;

        if (parentId is not null)
            requestBody["parent"] = parentId;

        if (estimatePoint is not null)
            requestBody["estimate_point"] = estimatePoint;

        if (typeId is not null)
            requestBody["type"] = typeId;

        if (moduleId is not null)
            requestBody["module"] = moduleId;

        if (startDate is not null)
            requestBody["start_date"] = startDate;

        if (targetDate is not null)
            requestBody["target_date"] = targetDate;

        if (externalSource is not null)
            requestBody["external_source"] = externalSource;

        if (externalId is not null)
            requestBody["external_id"] = externalId;

        if (isDraft is not null)
            requestBody["is_draft"] = isDraft;

        var jsonContent = JsonSerializer.Serialize(requestBody);
        var content = new StringContent(jsonContent, Encoding.UTF8)
        {
            Headers = { ContentType = new MediaTypeHeaderValue("application/json") }
        };

        return await SendPlaneAsync(HttpMethod.Post, url, "create_work_item", content);
    }

    //lay ttin cua work de thuc hien chuc nang
    public async Task<string> FindWorkItemsAsync(
        string? workItemId = null,
        string? name = null,
        string? description = null,
        string? priority = null,
        string? stateId = null,
        string? assigneeId = null,
        string? labelId = null,
        string? externalId = null,
        bool? isDraft = null)
    {
        if (string.IsNullOrWhiteSpace(workItemId) &&
            string.IsNullOrWhiteSpace(name) &&
            string.IsNullOrWhiteSpace(description) &&
            string.IsNullOrWhiteSpace(priority) &&
            string.IsNullOrWhiteSpace(stateId) &&
            string.IsNullOrWhiteSpace(assigneeId) &&
            string.IsNullOrWhiteSpace(labelId) &&
            string.IsNullOrWhiteSpace(externalId) &&
            isDraft is null)
        {
            throw new ArgumentException("Provide at least one search field.");
        }

        var scope = RequireScope();
        var url =
            $"{_baseUrl}/api/v1/workspaces/{Uri.EscapeDataString(scope.Workspace)}/projects/{Uri.EscapeDataString(scope.ProjectId!)}/work-items/?per_page=100";

        var json = await SendPlaneAsync(HttpMethod.Get, url, "find_work_items");
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var items = root.TryGetProperty("results", out var results)
            ? results
            : root;

        var matches = items.EnumerateArray()
            .Where(item => MatchesWorkItem(
                item, workItemId, name, description, priority, stateId,
                assigneeId, labelId, externalId, isDraft))
            .Select(item => item.Clone())
            .ToList();

        return JsonSerializer.Serialize(matches);
    }

    private static bool MatchesWorkItem(
        JsonElement item,
        string? workItemId,
        string? name,
        string? description,
        string? priority,
        string? stateId,
        string? assigneeId,
        string? labelId,
        string? externalId,
        bool? isDraft)
    {
        static string? Value(JsonElement value, string property) =>
            value.TryGetProperty(property, out var propertyValue)
                ? propertyValue.ToString()
                : null;

        static bool ContainsIgnoreCase(string? value, string? expected) =>
            expected is null ||
            (value?.Contains(expected, StringComparison.OrdinalIgnoreCase) ?? false);

        static bool EqualsIgnoreCase(string? value, string? expected) =>
            expected is null ||
            string.Equals(value, expected, StringComparison.OrdinalIgnoreCase);

        static bool ArrayContains(JsonElement item, string property, string expected)
        {
            if (!item.TryGetProperty(property, out var array) ||
                array.ValueKind != JsonValueKind.Array)
                return false;

            return array.EnumerateArray().Any(value =>
                string.Equals(value.ToString(), expected, StringComparison.OrdinalIgnoreCase) ||
                (value.ValueKind == JsonValueKind.Object &&
                 value.TryGetProperty("id", out var id) &&
                 string.Equals(id.ToString(), expected, StringComparison.OrdinalIgnoreCase)));
        }

        var itemDescription =
            Value(item, "description_stripped") ?? Value(item, "description_html");

        return EqualsIgnoreCase(Value(item, "id"), workItemId) &&
               ContainsIgnoreCase(Value(item, "name"), name) &&
               ContainsIgnoreCase(itemDescription, description) &&
               EqualsIgnoreCase(Value(item, "priority"), priority) &&
               EqualsIgnoreCase(Value(item, "state"), stateId) &&
               EqualsIgnoreCase(Value(item, "external_id"), externalId) &&
               (!isDraft.HasValue ||
                bool.TryParse(Value(item, "is_draft"), out var draft) && draft == isDraft.Value) &&
               (assigneeId is null || ArrayContains(item, "assignees", assigneeId)) &&
               (labelId is null || ArrayContains(item, "labels", labelId));
    }

    public async Task<string> UpdateWorkItemAsync(
        string workItemId,
        string? name,
        string? descriptionHtml,
        string? priority,
        string? stateId,
        List<string>? assigneeIds,
        List<string>? labelIds,
        string? parentId = null,
        int? estimatePoint = null,
        string? typeId = null,
        string? moduleId = null,
        string? startDate = null,
        string? targetDate = null,
        string? externalSource = null,
        string? externalId = null,
        bool? isDraft = null)
    {
        var scope = RequireScope();
        _logger.LogInformation("plane.update_work_item.request {RequestId} {UserId} {WorkspaceSlug} {ProjectId} {WorkItemId} {Operation}",
            _httpContextAccessor.HttpContext?.Request.Headers["X-Request-Id"].ToString(),
            _httpContextAccessor.HttpContext?.Request.Headers["X-MCP-User-Id"].ToString(),
            scope.Workspace, scope.ProjectId, workItemId, "update_work_item");
        var url =
            $"{_baseUrl}/api/v1/workspaces/{Uri.EscapeDataString(scope.Workspace)}/projects/{Uri.EscapeDataString(scope.ProjectId!)}/work-items/{Uri.EscapeDataString(workItemId!)}/";

        var requestBody = new Dictionary<string, object?>();

        if (name is not null)
            requestBody["name"] = name;

        if (descriptionHtml is not null)
            requestBody["description_html"] = descriptionHtml;

        if (priority is not null)
            requestBody["priority"] = priority;

        if (stateId is not null)
            requestBody["state"] = stateId;

        if (assigneeIds is not null)
            requestBody["assignees"] = assigneeIds;

        if (labelIds is not null)
            requestBody["labels"] = labelIds;

        if (parentId is not null)
            requestBody["parent"] = parentId;

        if (estimatePoint is not null)
            requestBody["estimate_point"] = estimatePoint;

        if (typeId is not null)
            requestBody["type"] = typeId;

        if (moduleId is not null)
            requestBody["module"] = moduleId;

        if (startDate is not null)
            requestBody["start_date"] = startDate;

        if (targetDate is not null)
            requestBody["target_date"] = targetDate;

        if (externalSource is not null)
            requestBody["external_source"] = externalSource;

        if (externalId is not null)
            requestBody["external_id"] = externalId;

        if (isDraft is not null)
            requestBody["is_draft"] = isDraft;

        return await SendPlaneAsync(HttpMethod.Patch, url, "update_work_item", new StringContent(
            JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"));
    }

    public async Task<string> DeleteWorkItemAsync(
        string? workItemId = null,
        string? delName = null,
        string? description = null,
        string? priority = null,
        string? stateId = null,
        string? assigneeId = null,
        string? labelId = null,
        string? externalId = null,
        bool? isDraft = null)
    {
        if (string.IsNullOrWhiteSpace(workItemId))
        {
            var searchResult = await FindWorkItemsAsync(
                null, delName, description, priority, stateId,
                assigneeId, labelId, externalId, isDraft);

            using var searchDocument = JsonDocument.Parse(searchResult);
            var matches = searchDocument.RootElement;

            if (matches.GetArrayLength() == 0)
                throw new ArgumentException("Không tìm thấy work item phù hợp.");

            if (matches.GetArrayLength() > 1)
                throw new ArgumentException(
                    "Có nhiều work item phù hợp. Hãy bổ sung điều kiện hoặc dùng workItemId.");

            workItemId = matches[0].GetProperty("id").GetString();
        }

        var scope = RequireScope();
        var url =
            $"{_baseUrl}/api/v1/workspaces/{Uri.EscapeDataString(scope.Workspace)}/projects/{Uri.EscapeDataString(scope.ProjectId!)}/work-items/{Uri.EscapeDataString(workItemId!)}/";

        await SendPlaneAsync(HttpMethod.Delete, url, "delete_work_item");

        return JsonSerializer.Serialize(new
        {
            success = true,
            workItemId,
            delName
        });
    }

    private void SetAuthentication(HttpRequestMessage request)
    {
        var context = _httpContextAccessor.HttpContext;
        var credential = context?.Request.Headers["X-Plane-Credential"].ToString();
        var userId = _httpContextAccessor.HttpContext?.Request.Headers["X-MCP-User-Id"].ToString();
        if (string.IsNullOrWhiteSpace(credential) || string.IsNullOrWhiteSpace(userId))
            throw new InvalidOperationException("Authenticated Plane execution context is missing.");
        PlaneAuthentication.Apply(request, credential, context?.Request.Headers["X-Plane-Auth-Type"].ToString());
    }

    private sealed record PlaneScope(string Workspace, string? ProjectId);
    private PlaneScope RequireScope(bool requireProject = true)
    {
        var context = _httpContextAccessor.HttpContext;
        var workspace = context?.Request.Headers["X-Plane-Workspace"].ToString();
        var projectId = context?.Request.Headers["X-Plane-Project-Id"].ToString();
        if (!IsScopeValue(workspace) || (requireProject && !IsScopeValue(projectId)))
            throw new InvalidOperationException("Authenticated Plane scope is required.");
        return new PlaneScope(workspace!, projectId);
    }
    private static string ResolveProject(PlaneScope scope, string? requestedProjectId)
    {
        if (!string.IsNullOrWhiteSpace(requestedProjectId) && !string.Equals(requestedProjectId, scope.ProjectId, StringComparison.Ordinal))
            throw new InvalidOperationException("Requested Plane project is outside the authenticated scope.");
        return scope.ProjectId!;
    }
    private static bool IsScopeValue(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 128 && value.All(character => char.IsLetterOrDigit(character) || character is '_' or '-');

    private string AuthType => string.Equals(_httpContextAccessor.HttpContext?.Request.Headers["X-Plane-Auth-Type"].ToString(), "oauth", StringComparison.OrdinalIgnoreCase) ? "oauth" : "api_key";
    private string ClassifyPlaneFailure(System.Net.HttpStatusCode status, string operation)
        => PlaneApiFailure.Classify(status, operation, AuthType);
    private string? RequiredScopeFor(System.Net.HttpStatusCode status, string operation) =>
        status == System.Net.HttpStatusCode.Forbidden &&
        operation == "list_project_states" &&
        AuthType == "oauth"
            ? "projects.states:read"
            : null;
    private static string PublicMessageFor(string code, string? requiredScope) => code switch
    {
        "PLANE_AUTH_REQUIRED" => "Plane authorization is invalid or expired; reconnect is required.",
        "PLANE_SCOPE_REQUIRED" => $"Plane OAuth needs {requiredScope ?? "an additional scope"}; reconnect Plane to grant the updated scope.",
        "PLANE_OAUTH_SCOPE_REQUIRED" => "Plane OAuth needs projects.members:read; reconnect Plane to grant the updated scope.",
        "PLANE_FORBIDDEN" => "Plane denied access to the selected resource.",
        "PLANE_PROJECT_NOT_FOUND" => "The configured Plane project was not found or is unavailable to this account.",
        "PLANE_WORK_ITEM_NOT_FOUND" => "The Plane work item was not found in the resolved project.",
        "PLANE_UNAVAILABLE" => "Plane API is unavailable.",
        _ => "Plane API rejected the request.",
    };
    private sealed record SafeProviderError(string Code, string Message);
    private static SafeProviderError SanitizePlaneError(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            var error = root.TryGetProperty("error", out var nested) && nested.ValueKind == JsonValueKind.Object ? nested : root;
            var code = error.TryGetProperty("code", out var codeValue) && codeValue.ValueKind == JsonValueKind.String
                ? SanitizeCode(codeValue.GetString())
                : "unknown";
            var safeText = ErrorMessage(error);
            return new SafeProviderError(code, Sanitize(safeText));
        }
        catch { return new SafeProviderError("non_json", "non-JSON provider error"); }
    }
    private static string? ErrorMessage(JsonElement element)
    {
        foreach (var property in new[] { "detail", "message", "error_description" })
            if (element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String)
                return value.GetString();
        return null;
    }
    private static string Sanitize(string? value)
    {
        var text = string.IsNullOrWhiteSpace(value) ? "no provider message" : value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        var redacted = System.Text.RegularExpressions.Regex.Replace(text, "(?i)(bearer\\s+|token|api[_-]?key|secret)\\s*[:=]?\\s*[^\\s,]+", "$1[redacted]");
        return redacted.Substring(0, Math.Min(redacted.Length, 300));
    }
    private static string SanitizeCode(string? value)
    {
        var code = string.IsNullOrWhiteSpace(value) ? "unknown" : value.Trim();
        return System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Za-z0-9_.:-]{1,128}$") ? code : "invalid_provider_code";
    }
    private void LogPlaneFailure(string operation, string url, int? status, string code, string? requiredScope, SafeProviderError providerError, Exception? exception)
    {
        var context = _httpContextAccessor.HttpContext;
        Uri.TryCreate(url, UriKind.Absolute, out var uri);
        _logger.LogError(exception, "plane.api.failed {Operation} {EndpointPath} {WorkspaceSlug} {ProjectId} {AuthType} {HttpStatus} {Code} {RequiredScope} {ProviderErrorCode} {ProviderError} {RequestId}", operation, uri?.AbsolutePath, context?.Request.Headers["X-Plane-Workspace"].ToString(), context?.Request.Headers["X-Plane-Project-Id"].ToString(), AuthType, status, code, requiredScope, providerError.Code, providerError.Message, context?.Request.Headers["X-Request-Id"].ToString());
    }
}
