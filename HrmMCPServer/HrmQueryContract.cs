using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Serialization;

// These types describe the MCP input. The HRM API remains the authority for
// dataset-specific field rules, value types, permissions and query validation.
public sealed class HrmQueryContract
{
    [JsonPropertyName("dataset"), Description("employees fields: id, display_name, department_id, department_name, title, employment_status, email (select/filter only). attendance_records fields: id, employee_id, work_date, status, minutes_worked. leave_requests fields: id, employee_id, leave_type_id, start_date, end_date, requested_days, status.")]
    public required HrmDataset Dataset { get; init; }

    [JsonPropertyName("select"), Description("Fields to return for a list query; omit when using aggregations.")]
    public string[]? Select { get; init; }

    [JsonPropertyName("filters"), Description("Up to eight filters. Attendance queries require work_date between two YYYY-MM-DD dates.")]
    public HrmFilter[]? Filters { get; init; }

    [JsonPropertyName("sort"), Description("Up to three sort keys. Aggregate queries may sort only by groupBy fields or aggregate aliases.")]
    public HrmSort[]? Sort { get; init; }

    [JsonPropertyName("groupBy"), Description("Up to two grouping fields; use only with aggregations.")]
    public string[]? GroupBy { get; init; }

    [JsonPropertyName("aggregations"), Description("Up to five aggregate expressions for self-scoped attendance or leave only. Company employee and team attendance aggregates are temporarily denied. count may omit field; sum, avg, min and max require minutes_worked or requested_days in the matching dataset.")]
    public HrmAggregation[]? Aggregations { get; init; }

    [JsonPropertyName("limit")]
    public int? Limit { get; init; }

    [JsonPropertyName("offset")]
    public int? Offset { get; init; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnknownProperties { get; init; }
}

[JsonConverter(typeof(JsonStringEnumConverter<HrmDataset>))]
public enum HrmDataset { employees, attendance_records, leave_requests }

[JsonConverter(typeof(JsonStringEnumConverter<HrmOperator>))]
public enum HrmOperator { eq, ne, gt, gte, lt, lte, @in, between, contains }

[JsonConverter(typeof(JsonStringEnumConverter<HrmAggregateFunction>))]
public enum HrmAggregateFunction { count, sum, avg, min, max }

[JsonConverter(typeof(JsonStringEnumConverter<HrmDirection>))]
public enum HrmDirection { asc, desc }

public sealed class HrmFilter
{
    [JsonPropertyName("field")]
    public required string Field { get; init; }

    [JsonPropertyName("operator")]
    public required HrmOperator Operator { get; init; }

    [JsonPropertyName("value"), Description("Scalar, null, or an array for in/between. Date values use YYYY-MM-DD.")]
    public required JsonElement Value { get; init; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnknownProperties { get; init; }
}

public sealed class HrmSort
{
    [JsonPropertyName("field"), Description("Dataset field, or an aggregation alias for aggregate queries.")]
    public required string Field { get; init; }

    [JsonPropertyName("direction")]
    public required HrmDirection Direction { get; init; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnknownProperties { get; init; }
}

public sealed class HrmAggregation
{
    [JsonPropertyName("function")]
    public required HrmAggregateFunction Function { get; init; }

    [JsonPropertyName("field")]
    public string? Field { get; init; }

    [JsonPropertyName("alias"), Description("Output column name: lowercase letter then up to 39 lowercase letters, digits or underscores.")]
    public required string Alias { get; init; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnknownProperties { get; init; }
}
