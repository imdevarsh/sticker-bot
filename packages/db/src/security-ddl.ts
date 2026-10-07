// Explicit deployment migration; never run schema changes from a web request.
export const securityDDL = [
  `CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash varchar(64) PRIMARY KEY, user_id varchar(255) NOT NULL,
    name text NOT NULL, image text, expires_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)`,
  `CREATE TABLE IF NOT EXISTS sticker_jobs (
    title varchar(255) PRIMARY KEY, creator varchar(255) NOT NULL,
    width integer NOT NULL, height integer NOT NULL, emojis jsonb NOT NULL DEFAULT '[]'::jsonb,
    pending_emoji text, status text NOT NULL, lease_until timestamptz NOT NULL
  )`,
  // Old login attempts are ephemeral and no longer used after this upgrade.
  `DO $$ BEGIN IF to_regclass('auth_attempt') IS NOT NULL THEN
    DELETE FROM auth_attempt;
  END IF; END $$`,
];
