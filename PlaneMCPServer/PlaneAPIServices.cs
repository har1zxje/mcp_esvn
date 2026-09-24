using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;

public class PlaneAPIServices
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly string _workspace;
    private readonly string _projectId;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ILogger<PlaneAPIServices> _logger;

    public PlaneAPIServices(
        IHttpClientFactory httpClientFactory, 
        string baseUrl, 
        string workspace, 
        string projectId,
        IHttpContextAccessor httpContextAccessor,
        ILogger<PlaneAPIServices> logger)
    {
        _httpClient = httpClientFactory.CreateClient();
        _baseUrl = baseUrl.TrimEnd('/');
        _workspace = workspace;
        _projectId = projectId;
        _httpContextAccessor = httpContextAccessor;
        _logger = logger;
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
        var url = $"{_baseUrl}/api/v1/workspaces/{_workspace}/projects/{_projectId}/work-items/";

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

        _logger.LogInformation(
            "Plane API request. Method={Method} Url={Url} Workspace={Workspace} ProjectId={ProjectId} PayloadLength={PayloadLength}",
            HttpMethod.Post,
            url,
            _workspace,
            _projectId,
            jsonContent.Length);

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = content
        };
        SetApiKey(request);

        var response = await _httpClient.SendAsync(request);

        var responseContent = await response.Content.ReadAsStringAsync(); 

        _logger.LogInformation(
            "Plane API response. StatusCode={StatusCode} ReasonPhrase={ReasonPhrase} BodyLength={BodyLength}",
            (int)response.StatusCode,
            response.ReasonPhrase,
            responseContent.Length);

        if(!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Plane API returned: {(int)response.StatusCode} ({response.ReasonPhrase}): {responseContent}");
        }
        return responseContent;
    }

    //lay ttin cua work de thuc hien chuc nang
    public async Task<string> FindWorkItemsAsync(
        string? name = null,
        string? description = null,
        string? priority = null,
        string? stateId = null,
        string? assigneeId = null,
        string? labelId = null,
        string? externalId = null,
        bool? isDraft = null)
    {
        if (string.IsNullOrWhiteSpace(name) &&
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

        var url =
            $"{_baseUrl}/api/v1/workspaces/{_workspace}/projects/{_projectId}/work-items/?per_page=100";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        SetApiKey(request);

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(request);
        }
        catch (Exception exception)
        {
            LogPlaneFailure("plane.find_work_items", url, null, "PLANE_UPSTREAM_UNREACHABLE", exception);
            throw new HttpRequestException("Plane API is unreachable.", exception);
        }
        if (!response.IsSuccessStatusCode)
        {
            LogPlaneFailure("plane.find_work_items", url, (int)response.StatusCode, response.StatusCode == System.Net.HttpStatusCode.Unauthorized ? "PLANE_UNAUTHORIZED" : response.StatusCode == System.Net.HttpStatusCode.Forbidden ? "PLANE_FORBIDDEN" : "PLANE_UPSTREAM_ERROR", null);
            throw new HttpRequestException($"Plane API returned HTTP {(int)response.StatusCode}.");
        }

        var json = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var items = root.TryGetProperty("results", out var results)
            ? results
            : root;

        var matches = items.EnumerateArray()
            .Where(item => MatchesWorkItem(
                item, name, description, priority, stateId,
                assigneeId, labelId, externalId, isDraft))
            .Select(item => item.Clone())
            .ToList();

        return JsonSerializer.Serialize(matches);
    }

    private static bool MatchesWorkItem(
        JsonElement item,
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

        return ContainsIgnoreCase(Value(item, "name"), name) &&
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
        var url =
            $"{_baseUrl}/api/v1/workspaces/{_workspace}/projects/{_projectId}/work-items/{workItemId}/";

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

        using var request = new HttpRequestMessage(HttpMethod.Patch, url)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(requestBody),
                Encoding.UTF8,
                "application/json")
        };
        SetApiKey(request);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadAsStringAsync();
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
                delName, description, priority, stateId,
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

        var url =
            $"{_baseUrl}/api/v1/workspaces/{_workspace}/projects/{_projectId}/work-items/{workItemId}/";

        using var request = new HttpRequestMessage(HttpMethod.Delete, url);
        SetApiKey(request);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        return JsonSerializer.Serialize(new
        {
            success = true,
            workItemId,
            delName
        });
    }

    private void SetApiKey(HttpRequestMessage request)
    {
        var context = _httpContextAccessor.HttpContext;
        var apiKey = context?.Request.Headers["X-Plane-API-Key"].ToString();
        var userId = _httpContextAccessor.HttpContext?.Request.Headers["X-MCP-User-Id"].ToString();
        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(userId))
            throw new InvalidOperationException("Authenticated Plane execution context is missing.");
        if (string.Equals(context?.Request.Headers["X-Plane-Auth-Type"].ToString(), "oauth", StringComparison.OrdinalIgnoreCase))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        else
            request.Headers.Add("X-API-Key", apiKey);
    }

    private void LogPlaneFailure(string operation, string url, int? status, string code, Exception? exception)
    {
        var context = _httpContextAccessor.HttpContext;
        Uri.TryCreate(url, UriKind.Absolute, out var uri);
        _logger.LogError(exception, "Plane MCP request failed. RequestId={RequestId} UserId={UserId} Operation={Operation} HttpStatus={HttpStatus} Hostname={Hostname} ErrorCode={ErrorCode}", context?.Request.Headers["X-Request-Id"].ToString(), context?.Request.Headers["X-MCP-User-Id"].ToString(), operation, status, uri?.Host, code);
    }
}
