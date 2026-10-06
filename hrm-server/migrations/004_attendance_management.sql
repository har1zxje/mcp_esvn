CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  work_date DATE NOT NULL,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'leave', 'remote', 'holiday')),
  minutes_worked INTEGER CHECK (minutes_worked IS NULL OR minutes_worked BETWEEN 0 AND 1440),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'device', 'import', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, work_date),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);

CREATE INDEX attendance_records_company_employee_date_idx
  ON attendance_records (company_id, employee_id, work_date DESC);
CREATE INDEX attendance_records_company_date_employee_idx
  ON attendance_records (company_id, work_date DESC, employee_id);
