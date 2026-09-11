using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

[McpServerToolType]
public class PlaneTools
{
    [McpServerTool, Description("Get all possible statuses that a work item could be created in. These statuses denote where a work item would be in a typical kanban flow. The state ids returned can be use with other tools such as creating work items")]
    public static async Task<string> GetAllWorkItemStatuses(
        PlaneAPIServices planeApiServices)
    {
        var statuses = await planeApiServices.GetProjectStateAsync();
        return JsonSerializer.Serialize(statuses);
    }

    [McpServerTool, Description("The tool allow for the creation of a work item in Plane, in the given state.")]
    public static async Task<string> CreateWorkItem(
        PlaneAPIServices planeApiServices,
        [Description("The title of main headline for the work item - keep it brief")] string? name = null,

        [Description("The detailed description of the work to be done where appropriate include acceptance criteria")] string? description = null,

        [Description("The state or status id of the work item, derived from the GetAllWorkItemStatuses tool")] string? stateId = null,
        
        [Description("The priority of the work item, can only be one of: none, urgent, high, medium or low. other values will be ignored.")] string? priority = null,
        [Description("The assignee ids for the work item")]List<string>? assigneeIds = null,
        [Description("The label ids of the work item")]List<string>? labelIds = null,
        [Description("The parent id of the work item")] string? parentId = null,
        [Description("The estimate points of the work item")] int? estimatePoint = null,
        [Description("The type id of the work item")] string? typeId = null,
        [Description("The module id of the work item")] string? moduleId = null,
        [Description("The start date of the work item")] string? startDate = null,
        [Description("The target date of the work item")] string? targetDate = null,
        [Description("The external source of the work item")] string? externalSource = null,
        [Description("The external id of the work item")] string? externalId = null,
        [Description("Whether the work item is a draft")] bool? isDraft = null)
    {
        if (name is null && description is null && priority is null && stateId is null && assigneeIds is null && labelIds is null)
            throw new ArgumentException(
                "Provide at least one of name, description, priority, stateId, assigneeIds, or labelIds.");
        
        return await planeApiServices.CreateWorkItemsAsync(
            name, 
            description, 
            stateId,
            priority,
            assigneeIds,
            labelIds,
            parentId,
            estimatePoint,
            typeId,
            moduleId,
            startDate,
            targetDate,
            externalSource,
            externalId,
            isDraft);
    }

    [McpServerTool]
    [Description("Update the name, description, priority, state, assignees, or labels of an existing Plane work item.")]
    public static async Task<string> UpdateWorkItem(
        PlaneAPIServices planeApiServices,

        [Description("The id of the existing Plane work item")] string workItemId,

        [Description("New work item name. Use null to keep the current name.")] string? newName = null,

        [Description("New HTML description. Use null to keep the current description.")] string? newDescription = null,
        
        [Description("New priority. Use null to keep the current priority. Priority only have 5 values: none, urgent, high, medium or low. If the value not in the list, it will alert the user and keep the current priority.")] string? newPriority = null,

        [Description("New state id. Use null to keep the current state.")] string? newStateId = null,

        [Description("New assignee ids. Use null to keep the current assignees.")] List<string>? newAssigneeIds = null,

        [Description("New label ids. Use null to keep the current labels.")] List<string>? newLabelIds = null,

        [Description("New parent id. Use null to keep the current parent.")] string? newParentId = null,

        [Description("New estimate points. Use null to keep the current estimate.")] int? newEstimatePoint = null,

        [Description("New work item type id. Use null to keep the current type.")] string? newTypeId = null,

        [Description("New module id. Use null to keep the current module.")] string? newModuleId = null,

        [Description("New start date. Use null to keep the current start date.")] string? newStartDate = null,

        [Description("New target date. Use null to keep the current target date.")] string? newTargetDate = null,

        [Description("New external source. Use null to keep the current external source.")] string? newExternalSource = null,

        [Description("New external id. Use null to keep the current external id.")] string? newExternalId = null,

        [Description("Whether the work item is a draft. Use null to keep the current value.")] bool? newIsDraft = null)
    {
        if (string.IsNullOrWhiteSpace(workItemId))
            throw new ArgumentException("workItemId is required.");

        if (newName is null && newDescription is null && newPriority is null && newStateId is null &&
            newAssigneeIds is null && newLabelIds is null && newParentId is null &&
            newEstimatePoint is null && newTypeId is null && newModuleId is null &&
            newStartDate is null && newTargetDate is null && newExternalSource is null &&
            newExternalId is null && newIsDraft is null)
            throw new ArgumentException(
                "Provide at least one field to update.");

        return await planeApiServices.UpdateWorkItemAsync(
            workItemId,
            newName,
            newDescription,
            newPriority,
            newStateId,
            newAssigneeIds,
            newLabelIds,
            newParentId,
            newEstimatePoint,
            newTypeId,
            newModuleId,
            newStartDate,
            newTargetDate,
            newExternalSource,
            newExternalId,
            newIsDraft);
    }

    [McpServerTool]
    [Description("Delete an existing Plane work item. Requires explicit confirmation.")]
    public static async Task<string> DeleteWorkItem(
        PlaneAPIServices planeApiServices,

        [Description("The id of the work item to delete")]
        string workItemId,

        [Description("Must be true to confirm deletion")]
        bool confirm = false)
    {
        if (string.IsNullOrWhiteSpace(workItemId))
            throw new ArgumentException("workItemId is required.");

        if (!confirm)
            throw new ArgumentException(
                "Deletion was not confirmed. Set confirm=true to delete this work item.");

        return await planeApiServices.DeleteWorkItemAsync(workItemId);
    }
}
