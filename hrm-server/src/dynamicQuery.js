import { HrmDomainError } from './services.js';

// Registry cố định bảng, cột, kiểu và thao tác được phép; Agent chỉ chọn tên field.
const field = (column, type, operations = ['select', 'filter', 'sort', 'group', 'aggregate']) => ({ column, type, operations });
// from: nguồn dữ liệu; company: cột giới hạn công ty; permission/scope: quyền;
// fields: cột cho phép; defaultSelect: cột trả về khi không chỉ định select.
const DATASETS = Object.freeze({
  employees: {
    from: 'employees e LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id',
    company: 'e.company_id', permission: 'employee.profile.read.any',
    fields: {
      id: field('e.id', 'string'), display_name: field('e.display_name', 'string'),
      department_id: field('e.department_id', 'string'), department_name: field('d.name', 'string'),
      title: field('e.title', 'string'), employment_status: field('e.employment_status', 'string'),
      email: field('e.email', 'string', ['select', 'filter']),
    },
    defaultSelect: ['id', 'display_name', 'department_id', 'employment_status'],
  },
  attendance_records: {
    from: 'attendance_records a JOIN employees e ON e.company_id = a.company_id AND e.id = a.employee_id',
    company: 'a.company_id', scope: 'attendance', dateField: 'work_date',
    fields: {
      id: field('a.id', 'string'), employee_id: field('a.employee_id', 'string'),
      work_date: field('a.work_date', 'date'), status: field('a.status', 'string'),
      minutes_worked: field('a.minutes_worked', 'number'),
    },
    defaultSelect: ['id', 'employee_id', 'work_date', 'status', 'minutes_worked'],
  },
  leave_requests: {
    from: 'leave_requests l', company: 'l.company_id', scope: 'leave',
    fields: {
      id: field('l.id', 'string'), employee_id: field('l.employee_id', 'string'),
      leave_type_id: field('l.leave_type_id', 'string'), start_date: field('l.start_date', 'date'),
      end_date: field('l.end_date', 'date'), requested_days: field('l.requested_days', 'number'),
      status: field('l.status', 'string'),
    },
    defaultSelect: ['id', 'leave_type_id', 'start_date', 'end_date', 'requested_days', 'status'],
  },
});

const invalid = (message = 'Invalid HRM query.') => { throw new HrmDomainError('HRM_VALIDATION_FAILED', message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid();
};
const boundedArray = (value, max) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
};
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validValue = (value, type) => value === null || (type === 'number' ? typeof value === 'number' && Number.isFinite(value) : type === 'date' ? validDate(value) : typeof value === 'string' && value.length <= 200);
const quote = (name) => `"${name}"`; // Chỉ dùng tên field trong registry hoặc alias đã kiểm tra.
const has = (context, permission) => Array.isArray(context.permissions) && context.permissions.includes(permission);

function scopeFor(dataset, context, add, query) {
  // context do hệ thống xác thực: công ty, nhân viên, phòng ban và các quyền.
  if (!context?.companyId || !context?.employeeId || !Array.isArray(context.permissions)) {
    throw new HrmDomainError('HRM_UNAUTHENTICATED', 'HRM actor context is required.', 401);
  }
  // Mọi truy vấn đều bắt đầu bằng company_id của context, không lấy từ Agent.
  const clauses = [`${dataset.company} = ${add(context.companyId)}`];
  let selfOnly = false;
  if (dataset.permission) {
    if (!has(context, dataset.permission)) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to query this dataset.', 403);
  } else if (dataset.scope === 'attendance') {
    // has kiểm tra quyền: chấm công cá nhân giới hạn employee_id;
    // quyền nhóm giới hạn department_id. Lọc rõ nhân viên mình ưu tiên phạm vi cá nhân.
    const ownFilter = Array.isArray(query.filters) && query.filters.some((item) =>
      item?.field === 'employee_id' && item.operator === 'eq' && item.value === context.employeeId);
    if (has(context, 'attendance.read.self') && (ownFilter || !has(context, 'attendance.read.team') || !context.departmentId)) {
      clauses.push(`a.employee_id = ${add(context.employeeId)}`);
      selfOnly = true;
    } else if (has(context, 'attendance.read.team') && context.departmentId) clauses.push(`e.department_id = ${add(context.departmentId)}`);
    else throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to query this dataset.', 403);
  } else if (dataset.scope === 'leave') {
    if (!has(context, 'leave.read.self')) throw new HrmDomainError('HRM_FORBIDDEN', 'You do not have permission to query this dataset.', 403);
    clauses.push(`l.employee_id = ${add(context.employeeId)}`);
    selfOnly = true;
  }
  // selfOnly cho bộ dựng SQL biết truy vấn đã giới hạn vào một người.
  return { clauses, selfOnly };
}

export function buildDynamicQuery(query, context) {
  // keys từ chối khóa lạ như sql/joins; dataset chỉ được lấy từ registry.
  keys(query, ['dataset', 'select', 'filters', 'sort', 'aggregations', 'groupBy', 'limit', 'offset']);
  const dataset = Object.hasOwn(DATASETS, query.dataset) ? DATASETS[query.dataset] : null;
  if (!dataset) invalid('Unknown HRM dataset.');
  // add lưu giá trị vào params và trả $1, $2...; không ghép giá trị vào SQL.
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  // scopeFor tạo WHERE bắt buộc trước các filter do Agent gửi.
  const { clauses: where, selfOnly } = scopeFor(dataset, context, add, query);
  // boundedArray biến giá trị thiếu thành [] và chặn mảng quá dài.
  const select = boundedArray(query.select, 12);
  const filters = boundedArray(query.filters, 8);
  const sort = boundedArray(query.sort, 3);
  const aggregations = boundedArray(query.aggregations, 5);
  const groupBy = boundedArray(query.groupBy, 2);
  const aggregate = aggregations.length > 0;
  if (query.aggregations !== undefined && !aggregate) invalid('At least one aggregation is required.');
  if ((aggregate && select.length) || (!aggregate && groupBy.length)) invalid('Invalid select/groupBy combination.');
  // lookup chỉ nhận field có trong dataset và được phép dùng cho thao tác này.
  const lookup = (name, operation) => {
    const entry = Object.hasOwn(dataset.fields, name) ? dataset.fields[name] : null;
    if (!entry || !entry.operations.includes(operation)) invalid(`Field is not available for ${operation}.`);
    return entry;
  };
  for (const name of select) lookup(name, 'select');
  for (const name of groupBy) lookup(name, 'group');
  if (new Set(select).size !== select.length || new Set(groupBy).size !== groupBy.length) invalid();

  // Mỗi filter qua keys, lookup và validValue trước khi thêm điều kiện vào where.
  // in/between kiểm tra mảng; contains thoát %, _ và \; null dùng IS NULL.
  let dateRange;
  for (const item of filters) {
    keys(item, ['field', 'operator', 'value']);
    const entry = lookup(item.field, 'filter');
    const op = item.operator;
    if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'contains'].includes(op)) invalid();
    if (op === 'contains' && entry.type !== 'string') invalid();
    if (['gt', 'gte', 'lt', 'lte', 'between'].includes(op) && entry.type === 'string') invalid();
    const value = item.value;
    if (op === 'in') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 20 || value.some((v) => !validValue(v, entry.type) || v === null)) invalid();
      where.push(`${entry.column} IN (${value.map(add).join(', ')})`);
    } else if (op === 'between') {
      if (!Array.isArray(value) || value.length !== 2 || value.some((v) => !validValue(v, entry.type) || v === null) || value[0] > value[1]) invalid();
      where.push(`${entry.column} BETWEEN ${add(value[0])} AND ${add(value[1])}`);
      if (item.field === dataset.dateField) dateRange = value;
    } else if (op === 'contains') {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) invalid();
      where.push(`${entry.column} ILIKE ${add(`%${value.replace(/[\\%_]/g, '\\$&')}%`)} ESCAPE '\\'`);
    } else {
      if (!validValue(value, entry.type) || (value === null && !['eq', 'ne'].includes(op))) invalid();
      if (value === null) where.push(`${entry.column} IS ${op === 'ne' ? 'NOT ' : ''}NULL`);
      else where.push(`${entry.column} ${ { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${add(value)}`);
    }
  }
  // Chấm công bắt buộc có khoảng work_date, tối đa 366 ngày lịch.
  if (dataset.dateField) {
    if (!dateRange || (Date.parse(dateRange[1]) - Date.parse(dateRange[0])) / 86400000 >= 366) invalid('A work_date range of at most 366 days is required.');
  }

  // projections là các cột sau SELECT; thống kê dùng groupBy và COUNT/SUM/AVG/MIN/MAX.
  // aliases giữ tên kết quả thống kê để kiểm tra sort và chuyển kiểu khi trả về.
  const aliases = new Set();
  const projections = aggregate
    ? [
      ...groupBy.map((name) => `${lookup(name, 'group').column} AS ${quote(name)}`),
      ...aggregations.map((item) => {
        keys(item, ['function', 'field', 'alias']);
        if (!['count', 'sum', 'avg', 'min', 'max'].includes(item.function) || typeof item.alias !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(item.alias) || aliases.has(item.alias) || groupBy.includes(item.alias)) invalid();
        aliases.add(item.alias);
        if (item.function === 'count' && item.field === undefined) return `COUNT(*) AS ${quote(item.alias)}`;
        const entry = lookup(item.field, 'aggregate');
        if (item.function !== 'count' && entry.type !== 'number') invalid('Aggregation requires a numeric field.');
        return `${item.function.toUpperCase()}(${entry.column}) AS ${quote(item.alias)}`;
      }),
    ]
    : (select.length ? select : dataset.defaultSelect).map((name) => `${lookup(name, 'select').column} AS ${quote(name)}`);
  if (aggregate && !projections.length) invalid();
  // Thống kê chỉ sort theo field đã nhóm hoặc alias trong kết quả.
  const order = sort.map((item) => {
    keys(item, ['field', 'direction']);
    if (!['asc', 'desc'].includes(item.direction)) invalid();
    if (aggregate) {
      if (!aliases.has(item.field) && !groupBy.includes(item.field)) invalid('Sort field must appear in aggregate output.');
      return `${quote(item.field)} ${item.direction.toUpperCase()}`;
    }
    return `${lookup(item.field, 'sort').column} ${item.direction.toUpperCase()}`;
  });
  // Giới hạn số dòng và vị trí bắt đầu để tránh trả dữ liệu quá lớn.
  const limit = query.limit === undefined ? 20 : query.limit;
  const offset = query.offset === undefined ? 0 : query.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) invalid();
  // Ví dụ “Top 3 phòng ban có nhiều nhân viên active nhất” bị chặn ở đây:
  // thống kê nhiều người chưa được phép, dù các bước dựng SELECT đã hợp lệ.
  if (aggregate && !selfOnly) throw new HrmDomainError('HRM_FORBIDDEN', 'This aggregate is not available.', 403);
  // effectiveOrder chọn thứ tự mặc định nếu thiếu sort; sql ghép các phần đã kiểm tra.
  const effectiveOrder = order.length ? order : aggregate ? groupBy.map((name) => `${quote(name)} ASC`) : [`${dataset.fields.id.column} ASC`];
  const sql = `SELECT ${projections.join(', ')} FROM ${dataset.from} WHERE ${where.join(' AND ')}${groupBy.length ? ` GROUP BY ${groupBy.map((name) => lookup(name, 'group').column).join(', ')}` : ''}${effectiveOrder.length ? ` ORDER BY ${effectiveOrder.join(', ')}` : ''} LIMIT ${add(limit)} OFFSET ${add(offset)}`;
  const outputFields = aggregate ? groupBy : (select.length ? select : dataset.defaultSelect);
  // Kế hoạch trả SQL, params, phân trang và kiểu field cho bước thực thi.
  return { sql, params, dataset: query.dataset, aggregate, limit, offset, aliases: [...aliases], outputFields, fields: dataset.fields };
}

export async function executeDynamicQuery(db, context, query) {
  // buildDynamicQuery kiểm tra đầu vào/quyền; lỗi tại đây xảy ra trước transaction.
  const plan = buildDynamicQuery(query, context);
  const started = Date.now();
  try {
    // Giao dịch chỉ đọc và timeout 3 giây giới hạn truy vấn PostgreSQL.
    const rows = await db.transaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      // Đây là lệnh thực sự chạy SQL với các giá trị plan.params.
      return (await client.query(plan.sql, plan.params)).rows;
    });
    // PostgreSQL có thể trả number dạng chuỗi và date dạng Date; chuẩn hóa cho API.
    const data = rows.map((row) => {
      const result = { ...row };
      for (const alias of plan.aliases) if (result[alias] !== null && result[alias] !== undefined) result[alias] = Number(result[alias]);
      for (const name of plan.outputFields) {
        if (result[name] == null) continue;
        if (plan.fields[name].type === 'number') result[name] = Number(result[name]);
        else if (plan.fields[name].type === 'date' && result[name] instanceof Date) {
          const date = result[name];
          result[name] = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        }
      }
      return result;
    });
    // Ghi số dòng và thời gian; count là số dòng của trang hiện tại.
    console.info(JSON.stringify({ event: 'hrm.query', requestId: context.requestId, dataset: plan.dataset, operation: plan.aggregate ? 'aggregate' : 'list', durationMs: Date.now() - started, resultCount: data.length }));
    return { dataset: plan.dataset, rows: data, count: data.length, limit: plan.limit, offset: plan.offset };
  } catch (error) {
    // Ghi mã lỗi rồi ném tiếp để tầng gọi xử lý.
    console.warn(JSON.stringify({ event: 'hrm.query.failed', requestId: context.requestId, dataset: plan.dataset, durationMs: Date.now() - started, errorCode: error.code ?? 'HRM_INTERNAL' }));
    throw error;
  }
}
