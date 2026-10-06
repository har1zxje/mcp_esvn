using System.Net;
using System.Net.Http.Headers;

public static class PlaneAuthentication
{
    public static void Apply(HttpRequestMessage request, string credential, string? authType)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(credential);
        if (string.Equals(authType, "oauth", StringComparison.OrdinalIgnoreCase))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);
            return;
        }
        request.Headers.Add("X-API-Key", credential);
    }
}

public static class PlaneApiFailure
{
    public static string Classify(HttpStatusCode status, string operation, string authType) => status switch
    {
        HttpStatusCode.Unauthorized => "PLANE_AUTH_REQUIRED",
        HttpStatusCode.Forbidden when operation == "list_project_states" && authType == "oauth" => "PLANE_SCOPE_REQUIRED",
        HttpStatusCode.Forbidden when operation == "list_project_members" && authType == "oauth" => "PLANE_OAUTH_SCOPE_REQUIRED",
        HttpStatusCode.Forbidden => "PLANE_FORBIDDEN",
        // Mutations are preceded by a project-scope and work-item resolution
        // in the backend.  At this point a 404 identifies a work item that
        // disappeared after resolution, rather than incorrectly blaming the
        // user's project selection.
        HttpStatusCode.NotFound when operation is "update_work_item" or "delete_work_item" => "PLANE_WORK_ITEM_NOT_FOUND",
        HttpStatusCode.NotFound => "PLANE_PROJECT_NOT_FOUND",
        _ when (int)status >= 500 => "PLANE_UNAVAILABLE",
        _ => "PLANE_API_ERROR",
    };
}
