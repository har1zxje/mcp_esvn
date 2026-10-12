-- Run with psql connected to the intended test/staging database as a role
-- permitted to create roles and grant table privileges. Supply dq_role,
-- dq_password and target_database through psql variables. Use a new role;
-- this script refuses an existing role so previous grants cannot be inherited.
-- Never put the password in this file or a command log.
\set ON_ERROR_STOP on
BEGIN;
SELECT format('DO $guard$ BEGIN IF current_database() <> %L THEN RAISE EXCEPTION ''Wrong target database''; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN RAISE EXCEPTION ''DQE role already exists''; END IF; END $guard$', :'target_database', :'dq_role') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'dq_role', :'dq_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'dq_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'dq_role') \gexec
SELECT format('GRANT SELECT ON TABLE public.companies, public.departments, public.employees, public.attendance_records, public.leave_requests TO %I', :'dq_role') \gexec
-- PostgreSQL grants TEMPORARY on new databases to PUBLIC by default. Revoke it
-- in the dedicated test/staging database so this role cannot create temp tables.
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec
COMMIT;
