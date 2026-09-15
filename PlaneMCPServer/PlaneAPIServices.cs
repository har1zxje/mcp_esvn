using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;

public class PlaneAPIServices
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly string _workspace;
    private readonly string _projectId;

    public PlaneAPIServices(
        IHttpClientFactory httpClientFactory, 
        string baseUrl, 
        string workspace, 
        string projectId,
        string apiKey)
    {
        _httpClient = httpClientFactory.CreateClient();
        _apiKey = apiKey;
        _baseUrl = baseUrl.TrimEnd('/');
        _workspace = workspace;
        _projectId = projectId;
    } 

    public async Task<string> GetProjectStateAsync()
    {
        var url = $"{_baseUrl}/api/v1/workspaces/{_workspace}/projects/{_projectId}/states/";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        SetApiKey(request);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return content;
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

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = content
        };
        SetApiKey(request);

        var response = await _httpClient.SendAsync(request);

        var responseContent = await response.Content.ReadAsStringAsync(); 

        if(!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Plane API returned: {(int)response.StatusCode} ({response.ReasonPhrase}): {responseContent}");
        }
        return responseContent;
    }

    //lay ttin cua work de thuc hien chuc nang
    public async Task<string> GetWorkItemAsync(string workItemId)
    {
        var url =
            $"{_baseUrl}/api/v1/workspaces/{_workspace}/projects/{_projectId}/work-items/{workItemId}/";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        SetApiKey(request);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadAsStringAsync();
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

    public async Task<string> DeleteWorkItemAsync(string workItemId)
    {
        if (string.IsNullOrWhiteSpace(workItemId))
            throw new ArgumentException("workItemId is required.");

        var url =
            $"{_baseUrl}/api/v1/workspaces/{_workspace}/projects/{_projectId}/work-items/{workItemId}/";

        using var request = new HttpRequestMessage(HttpMethod.Delete, url);
        SetApiKey(request);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        return JsonSerializer.Serialize(new
        {
            success = true,
            workItemId
        });
    }

    private void SetApiKey(HttpRequestMessage request)
    {
        request.Headers.Remove("X-API-Key");
        request.Headers.Add("X-API-Key", _apiKey);
    }
}
