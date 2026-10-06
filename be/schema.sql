CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_google_sub_idx ON users (google_sub);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'name')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'display_name') THEN
    ALTER TABLE users RENAME COLUMN name TO display_name;
  END IF;
END $$;
ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (session_token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('plane', 'discord')),
  encrypted_credentials JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS integrations_user_id_idx ON integrations (user_id);
CREATE INDEX IF NOT EXISTS integrations_user_provider_idx ON integrations (user_id, provider);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  legacy_owner_id TEXT,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS legacy_owner_id TEXT;
ALTER TABLE conversations ALTER COLUMN owner_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_owner_id_idx ON conversations (owner_id);
CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations (updated_at);

-- Server-owned, one-time authorization state for semantic mutations. The model
-- never authorizes a mutation with a boolean argument: future execute paths
-- must atomically consume a record bound to its authenticated context.
CREATE TABLE IF NOT EXISTS mutation_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL CHECK (company_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  mutation_kind TEXT NOT NULL CHECK (mutation_kind ~ '^[a-z][a-z0-9._-]{0,99}$'),
  target_ids JSONB NOT NULL CHECK (jsonb_typeof(target_ids) = 'object'),
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  resolved_payload JSONB NOT NULL CHECK (jsonb_typeof(resolved_payload) = 'object'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mutation_confirmations_active_idx ON mutation_confirmations (user_id, company_id, conversation_id, expires_at) WHERE consumed_at IS NULL;
