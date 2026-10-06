CREATE TABLE leave_types (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  requires_balance BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);

CREATE TABLE leave_balances (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  leave_type_id TEXT NOT NULL,
  leave_year INTEGER NOT NULL CHECK (leave_year BETWEEN 2000 AND 2100),
  allocated_days NUMERIC(6,2) NOT NULL CHECK (allocated_days >= 0),
  used_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0 AND used_days <= allocated_days),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, employee_id, leave_type_id, leave_year),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_types(company_id, id) ON DELETE CASCADE
);

CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  leave_type_id TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  requested_days NUMERIC(6,2) NOT NULL CHECK (requested_days > 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_types(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX leave_requests_company_employee_idx ON leave_requests (company_id, employee_id, start_date DESC);
CREATE INDEX leave_requests_company_status_idx ON leave_requests (company_id, status, created_at DESC);

CREATE TABLE leave_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  leave_request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  approver_employee_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leave_request_id),
  FOREIGN KEY (company_id, approver_employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT
);
