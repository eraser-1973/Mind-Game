CREATE TABLE admin_auth_policies (
  auth_policy_version TEXT PRIMARY KEY,
  password_algorithm TEXT NOT NULL CHECK (password_algorithm = 'PBKDF2'),
  pbkdf2_hash TEXT NOT NULL CHECK (pbkdf2_hash = 'SHA-256'),
  pbkdf2_iterations INTEGER NOT NULL CHECK (pbkdf2_iterations >= 600000),
  salt_bytes INTEGER NOT NULL CHECK (salt_bytes >= 16),
  derived_key_bytes INTEGER NOT NULL CHECK (derived_key_bytes >= 32),
  session_absolute_sec INTEGER NOT NULL CHECK (session_absolute_sec > 0),
  session_idle_sec INTEGER NOT NULL CHECK (session_idle_sec > 0),
  session_touch_interval_sec INTEGER NOT NULL CHECK (session_touch_interval_sec > 0),
  rate_limit_window_sec INTEGER NOT NULL CHECK (rate_limit_window_sec > 0),
  rate_limit_max_failures INTEGER NOT NULL CHECK (rate_limit_max_failures > 0),
  global_rate_limit_window_sec INTEGER NOT NULL CHECK (global_rate_limit_window_sec > 0),
  global_rate_limit_max_failures INTEGER NOT NULL CHECK (global_rate_limit_max_failures > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  published_at TEXT CHECK (published_at IS NULL OR julianday(published_at) IS NOT NULL),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE admin_users (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  admin_user_id TEXT NOT NULL UNIQUE CHECK (
    length(admin_user_id) = 36
    AND substr(admin_user_id, 9, 1) = '-'
    AND substr(admin_user_id, 14, 1) = '-'
    AND substr(admin_user_id, 19, 1) = '-'
    AND substr(admin_user_id, 24, 1) = '-'
    AND lower(replace(admin_user_id, '-', '')) NOT GLOB '*[^0-9a-f]*'
  ),
  username TEXT NOT NULL CHECK (
    length(trim(username)) BETWEEN 3 AND 64
    AND trim(username) NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  username_normalized TEXT NOT NULL UNIQUE CHECK (
    length(username_normalized) BETWEEN 3 AND 64
    AND username_normalized = lower(trim(username))
    AND username_normalized NOT GLOB '*[^a-z0-9._-]*'
  ),
  password_algorithm TEXT NOT NULL CHECK (password_algorithm = 'PBKDF2-SHA256'),
  password_iterations INTEGER NOT NULL CHECK (password_iterations >= 600000),
  password_salt_base64 TEXT NOT NULL CHECK (
    length(password_salt_base64) = 24
    AND password_salt_base64 NOT GLOB '*[^A-Za-z0-9+/=]*'
    AND substr(password_salt_base64, -2) = '=='
  ),
  password_hash_base64 TEXT NOT NULL CHECK (
    length(password_hash_base64) = 44
    AND password_hash_base64 NOT GLOB '*[^A-Za-z0-9+/=]*'
    AND substr(password_hash_base64, -1) = '='
  ),
  password_version INTEGER NOT NULL CHECK (password_version >= 1),
  auth_policy_version TEXT NOT NULL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  password_updated_at TEXT NOT NULL CHECK (julianday(password_updated_at) IS NOT NULL),
  last_login_at TEXT CHECK (last_login_at IS NULL OR julianday(last_login_at) IS NOT NULL),
  FOREIGN KEY (auth_policy_version)
    REFERENCES admin_auth_policies(auth_policy_version) ON DELETE RESTRICT
);

CREATE TABLE admin_sessions (
  admin_session_id TEXT PRIMARY KEY CHECK (
    length(admin_session_id) = 36
    AND substr(admin_session_id, 9, 1) = '-'
    AND substr(admin_session_id, 14, 1) = '-'
    AND substr(admin_session_id, 19, 1) = '-'
    AND substr(admin_session_id, 24, 1) = '-'
    AND lower(replace(admin_session_id, '-', '')) NOT GLOB '*[^0-9a-f]*'
  ),
  admin_user_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE CHECK (
    length(session_token_hash) = 64
    AND session_token_hash = lower(session_token_hash)
    AND session_token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  csrf_token_hash TEXT NOT NULL CHECK (
    length(csrf_token_hash) = 64
    AND csrf_token_hash = lower(csrf_token_hash)
    AND csrf_token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  password_version INTEGER NOT NULL CHECK (password_version >= 1),
  auth_policy_version TEXT NOT NULL,
  client_fingerprint_hash TEXT CHECK (
    client_fingerprint_hash IS NULL OR (
      length(client_fingerprint_hash) = 64
      AND client_fingerprint_hash = lower(client_fingerprint_hash)
      AND client_fingerprint_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  user_agent_hash TEXT CHECK (
    user_agent_hash IS NULL OR (
      length(user_agent_hash) = 64
      AND user_agent_hash = lower(user_agent_hash)
      AND user_agent_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  last_seen_at TEXT NOT NULL CHECK (julianday(last_seen_at) IS NOT NULL),
  idle_expires_at TEXT NOT NULL CHECK (julianday(idle_expires_at) IS NOT NULL),
  absolute_expires_at TEXT NOT NULL CHECK (julianday(absolute_expires_at) IS NOT NULL),
  revoked_at TEXT CHECK (revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL),
  revoke_reason TEXT CHECK (
    revoke_reason IS NULL OR revoke_reason IN (
      'logout', 'new_login', 'idle_expired', 'absolute_expired',
      'password_rotated', 'security_revoked'
    )
  ),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (auth_policy_version)
    REFERENCES admin_auth_policies(auth_policy_version) ON DELETE RESTRICT,
  CHECK (julianday(idle_expires_at) > julianday(created_at)),
  CHECK (julianday(absolute_expires_at) > julianday(created_at)),
  CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE TABLE admin_login_attempts (
  attempt_id TEXT PRIMARY KEY,
  username_hash TEXT NOT NULL CHECK (
    length(username_hash) = 64
    AND username_hash = lower(username_hash)
    AND username_hash NOT GLOB '*[^0-9a-f]*'
  ),
  client_fingerprint_hash TEXT NOT NULL CHECK (
    length(client_fingerprint_hash) = 64
    AND client_fingerprint_hash = lower(client_fingerprint_hash)
    AND client_fingerprint_hash NOT GLOB '*[^0-9a-f]*'
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  request_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL CHECK (julianday(attempted_at) IS NOT NULL)
);

CREATE TABLE admin_audit_logs (
  audit_id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  admin_session_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'admin_provisioned',
    'admin_password_rotated',
    'admin_login_success',
    'admin_login_failure',
    'admin_login_rate_limited',
    'admin_logout',
    'admin_session_revoked',
    'admin_session_idle_expired',
    'admin_session_absolute_expired',
    'admin_audit_logs_viewed'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  target_type TEXT,
  target_id TEXT,
  request_id TEXT NOT NULL,
  client_fingerprint_hash TEXT CHECK (
    client_fingerprint_hash IS NULL OR (
      length(client_fingerprint_hash) = 64
      AND client_fingerprint_hash = lower(client_fingerprint_hash)
      AND client_fingerprint_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json) AND json_type(metadata_json) = 'object'
  ),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (admin_session_id) REFERENCES admin_sessions(admin_session_id) ON DELETE RESTRICT
);

CREATE INDEX admin_sessions_user_idx ON admin_sessions (admin_user_id);
CREATE INDEX admin_sessions_token_idx ON admin_sessions (session_token_hash);
CREATE INDEX admin_sessions_revoked_idx ON admin_sessions (revoked_at);
CREATE INDEX admin_sessions_absolute_expiry_idx ON admin_sessions (absolute_expires_at);
CREATE UNIQUE INDEX admin_sessions_one_active_idx
ON admin_sessions (admin_user_id) WHERE revoked_at IS NULL;

CREATE INDEX admin_login_attempts_username_time_idx
ON admin_login_attempts (username_hash, attempted_at);
CREATE INDEX admin_login_attempts_fingerprint_time_idx
ON admin_login_attempts (client_fingerprint_hash, attempted_at);
CREATE INDEX admin_login_attempts_username_fingerprint_time_idx
ON admin_login_attempts (username_hash, client_fingerprint_hash, attempted_at);

CREATE INDEX admin_audit_logs_time_idx ON admin_audit_logs (created_at);
CREATE INDEX admin_audit_logs_user_time_idx
ON admin_audit_logs (admin_user_id, created_at);
CREATE INDEX admin_audit_logs_action_time_idx
ON admin_audit_logs (action, created_at);
CREATE INDEX admin_audit_logs_outcome_time_idx
ON admin_audit_logs (outcome, created_at);
CREATE UNIQUE INDEX admin_audit_logs_session_terminal_once_idx
ON admin_audit_logs (admin_session_id, action)
WHERE admin_session_id IS NOT NULL AND action IN (
  'admin_logout',
  'admin_session_revoked',
  'admin_session_idle_expired',
  'admin_session_absolute_expired'
);

CREATE TRIGGER admin_auth_policies_published_no_update
BEFORE UPDATE ON admin_auth_policies
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published admin auth policies are immutable');
END;

CREATE TRIGGER admin_auth_policies_published_no_delete
BEFORE DELETE ON admin_auth_policies
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published admin auth policies are immutable');
END;

CREATE TRIGGER admin_users_identity_guard
BEFORE UPDATE ON admin_users
WHEN OLD.singleton_id <> NEW.singleton_id
  OR OLD.admin_user_id <> NEW.admin_user_id
  OR OLD.username <> NEW.username
  OR OLD.username_normalized <> NEW.username_normalized
  OR OLD.created_at <> NEW.created_at
  OR NEW.password_version < OLD.password_version
  OR (
    (OLD.password_salt_base64 <> NEW.password_salt_base64
      OR OLD.password_hash_base64 <> NEW.password_hash_base64)
    AND NEW.password_version <> OLD.password_version + 1
  )
BEGIN
  SELECT RAISE(ABORT, 'administrator identity and password history are protected');
END;

CREATE TRIGGER admin_sessions_identity_guard
BEFORE UPDATE ON admin_sessions
WHEN OLD.admin_session_id <> NEW.admin_session_id
  OR OLD.admin_user_id <> NEW.admin_user_id
  OR OLD.session_token_hash <> NEW.session_token_hash
  OR OLD.password_version <> NEW.password_version
  OR OLD.auth_policy_version <> NEW.auth_policy_version
  OR OLD.client_fingerprint_hash IS NOT NEW.client_fingerprint_hash
  OR OLD.user_agent_hash IS NOT NEW.user_agent_hash
  OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'administrator session identity is immutable');
END;

CREATE TRIGGER admin_audit_logs_no_update
BEFORE UPDATE ON admin_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'administrator audit logs are immutable');
END;

CREATE TRIGGER admin_audit_logs_no_delete
BEFORE DELETE ON admin_audit_logs
BEGIN
  SELECT RAISE(ABORT, 'administrator audit logs are immutable');
END;

INSERT INTO admin_auth_policies (
  auth_policy_version, password_algorithm, pbkdf2_hash, pbkdf2_iterations,
  salt_bytes, derived_key_bytes, session_absolute_sec, session_idle_sec,
  session_touch_interval_sec, rate_limit_window_sec, rate_limit_max_failures,
  global_rate_limit_window_sec, global_rate_limit_max_failures, status,
  created_at, published_at
) VALUES (
  'admin-auth-1.0.0', 'PBKDF2', 'SHA-256', 600000,
  16, 32, 28800, 1800, 300, 900, 5, 3600, 30, 'published',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

UPDATE app_metadata
SET value = '9', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'schema_version';
