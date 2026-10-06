CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_employee_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  FOREIGN KEY (company_id, created_by_employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX projects_company_status_idx ON projects (company_id, status, name);

CREATE TABLE project_members (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  membership_role TEXT NOT NULL DEFAULT 'member' CHECK (membership_role IN ('manager', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, project_id, employee_id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
);
CREATE INDEX project_members_company_employee_idx ON project_members (company_id, employee_id, project_id);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  created_by_employee_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, created_by_employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX tasks_company_project_status_idx ON tasks (company_id, project_id, status, updated_at DESC);

CREATE TABLE task_assignments (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  assigned_by_employee_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, task_id, employee_id),
  UNIQUE (company_id, task_id),
  FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, assigned_by_employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX task_assignments_company_employee_idx ON task_assignments (company_id, employee_id, task_id);

CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, task_id) REFERENCES tasks(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX task_comments_company_task_created_idx ON task_comments (company_id, task_id, created_at);
