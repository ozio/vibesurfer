use std::{path::Path, sync::Mutex};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use thiserror::Error;

use crate::protocol::{ArtifactRecord, ProviderConnectionRecord, SiteSessionRecord, SiteWorldRecord};

const MAX_ARTIFACT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SITE_WORLD_BYTES: usize = 1024 * 1024;
const MAX_SITE_SESSION_BYTES: usize = 256 * 1024;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("stored JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("artifact exceeds the 4 MiB storage limit")]
    ArtifactTooLarge,
    #[error("site world exceeds the 1 MiB storage limit")]
    SiteWorldTooLarge,
    #[error("site world revision cannot be negative")]
    InvalidSiteWorldRevision,
    #[error("site session exceeds the 256 KiB storage limit")]
    SiteSessionTooLarge,
    #[error("site session revision cannot be negative")]
    InvalidSiteSessionRevision,
    #[error("storage lock is poisoned")]
    Poisoned,
}

pub struct Storage {
    connection: Mutex<Connection>,
}

impl Storage {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                StorageError::Database(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
            })?;
        }
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.execute_batch(SCHEMA)?;
        migrate_site_world_incarnations(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn save_artifact(&self, artifact: &ArtifactRecord) -> Result<(), StorageError> {
        if artifact.html.len() > MAX_ARTIFACT_BYTES {
            return Err(StorageError::ArtifactTooLarge);
        }
        let payload = serde_json::to_string(&artifact.payload)?;
        self.connection_guard()?.execute(
            "INSERT INTO artifacts (id, profile_id, site_id, url, title, html, created_at, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               profile_id=excluded.profile_id, site_id=excluded.site_id,
               url=excluded.url, title=excluded.title, html=excluded.html,
               created_at=excluded.created_at, payload=excluded.payload",
            params![
                artifact.id,
                artifact.profile_id,
                artifact.site_id,
                artifact.url,
                artifact.title,
                artifact.html,
                artifact.created_at,
                payload
            ],
        )?;
        Ok(())
    }

    pub fn artifact(
        &self,
        id: &str,
        profile_id: &str,
    ) -> Result<Option<ArtifactRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let row = connection
            .query_row(
                "SELECT id, profile_id, site_id, url, title, html, created_at, payload
                 FROM artifacts WHERE id = ?1 AND profile_id = ?2",
                params![id, profile_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .optional()?;
        row.map(tuple_to_artifact).transpose()
    }

    pub fn latest_artifact_for_url(
        &self,
        profile_id: &str,
        site_id: &str,
        url: &str,
    ) -> Result<Option<ArtifactRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let row = connection
            .query_row(
                "SELECT id, profile_id, site_id, url, title, html, created_at, payload
                 FROM artifacts WHERE profile_id = ?1 AND site_id = ?2 AND url = ?3
                 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![profile_id, site_id, url],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .optional()?;
        row.map(tuple_to_artifact).transpose()
    }

    pub fn list_artifacts(
        &self,
        profile_id: &str,
        limit: usize,
    ) -> Result<Vec<ArtifactRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, site_id, url, title, html, created_at, payload
             FROM artifacts WHERE profile_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = statement.query_map(params![profile_id, limit.min(500) as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;
        rows.map(|row| tuple_to_artifact(row?)).collect()
    }

    pub fn delete_profile_artifacts(&self, profile_id: &str) -> Result<usize, StorageError> {
        Ok(self
            .connection_guard()?
            .execute("DELETE FROM artifacts WHERE profile_id = ?1", [profile_id])?)
    }

    pub fn upsert_site_world(&self, site_world: &SiteWorldRecord) -> Result<bool, StorageError> {
        if site_world.revision < 0 {
            return Err(StorageError::InvalidSiteWorldRevision);
        }
        if site_world.state != "active" && site_world.state != "archived" {
            return Err(StorageError::Database(rusqlite::Error::InvalidParameterName(
                "site world state must be active or archived".into(),
            )));
        }
        let payload = serde_json::to_string(&site_world.payload)?;
        if payload.len() > MAX_SITE_WORLD_BYTES {
            return Err(StorageError::SiteWorldTooLarge);
        }

        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        let existing_revision = transaction.query_row(
            "SELECT revision FROM site_worlds WHERE profile_id=?1 AND id=?2",
            params![site_world.profile_id, site_world.id],
            |row| row.get::<_, Option<i64>>(0),
        ).optional()?.flatten();
        if existing_revision.is_some_and(|revision| revision > site_world.revision) {
            return Ok(false);
        }

        if site_world.state == "active" {
            transaction.execute(
                "UPDATE site_worlds SET state='archived', archived_at=?3, updated_at=?3
                 WHERE profile_id=?1 AND origin=?2 AND state='active' AND id<>?4",
                params![site_world.profile_id, site_world.origin, site_world.updated_at, site_world.id],
            )?;
        }
        transaction.execute(
            "INSERT INTO site_worlds
               (id, profile_id, origin, state, revision, payload, created_at, updated_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               profile_id=excluded.profile_id, origin=excluded.origin, state=excluded.state,
               revision=excluded.revision, payload=excluded.payload,
               created_at=excluded.created_at, updated_at=excluded.updated_at,
               archived_at=excluded.archived_at",
            params![
                site_world.id,
                site_world.profile_id,
                site_world.origin,
                site_world.state,
                site_world.revision,
                payload,
                site_world.created_at,
                site_world.updated_at,
                site_world.archived_at,
            ],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn site_world(
        &self,
        id: &str,
        profile_id: &str,
    ) -> Result<Option<SiteWorldRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let row = connection
            .query_row(
                "SELECT id, profile_id, origin, state, revision, created_at, updated_at, archived_at, payload
                 FROM site_worlds WHERE id=?1 AND profile_id=?2",
                params![id, profile_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, String>(8)?,
                    ))
                },
            )
            .optional()?;
        row.map(tuple_to_site_world).transpose()
    }

    pub fn list_site_worlds(
        &self,
        profile_id: &str,
        limit: usize,
    ) -> Result<Vec<SiteWorldRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, origin, state, revision, created_at, updated_at, archived_at, payload
             FROM site_worlds WHERE profile_id=?1
             ORDER BY updated_at DESC, id ASC LIMIT ?2",
        )?;
        let rows = statement.query_map(params![profile_id, limit.min(500) as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
            ))
        })?;
        rows.map(|row| tuple_to_site_world(row?)).collect()
    }

    pub fn delete_site_world(&self, id: &str, profile_id: &str) -> Result<usize, StorageError> {
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM site_sessions WHERE site_world_id=?1 AND profile_id=?2",
            params![id, profile_id],
        )?;
        let deleted = transaction.execute(
            "DELETE FROM site_worlds WHERE id=?1 AND profile_id=?2",
            params![id, profile_id],
        )?;
        transaction.commit()?;
        Ok(deleted)
    }

    pub fn delete_profile_site_worlds(&self, profile_id: &str) -> Result<usize, StorageError> {
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM site_sessions WHERE profile_id=?1", [profile_id])?;
        let deleted = transaction.execute("DELETE FROM site_worlds WHERE profile_id=?1", [profile_id])?;
        transaction.commit()?;
        Ok(deleted)
    }

    pub fn upsert_site_session(&self, session: &SiteSessionRecord) -> Result<bool, StorageError> {
        if session.revision < 0 {
            return Err(StorageError::InvalidSiteSessionRevision);
        }
        let payload = serde_json::to_string(&session.payload)?;
        if payload.len() > MAX_SITE_SESSION_BYTES {
            return Err(StorageError::SiteSessionTooLarge);
        }
        let changed = self.connection_guard()?.execute(
            "INSERT INTO site_sessions (profile_id, site_world_id, revision, updated_at, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(profile_id, site_world_id) DO UPDATE SET
               revision=excluded.revision, updated_at=excluded.updated_at, payload=excluded.payload
             WHERE excluded.revision >= site_sessions.revision",
            params![session.profile_id, session.site_world_id, session.revision, session.updated_at, payload],
        )?;
        Ok(changed > 0)
    }

    pub fn site_session(
        &self,
        profile_id: &str,
        site_world_id: &str,
    ) -> Result<Option<SiteSessionRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let row = connection.query_row(
            "SELECT profile_id, site_world_id, revision, updated_at, payload
             FROM site_sessions WHERE profile_id=?1 AND site_world_id=?2",
            params![profile_id, site_world_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            )),
        ).optional()?;
        row.map(|row| Ok(SiteSessionRecord {
            profile_id: row.0,
            site_world_id: row.1,
            revision: row.2,
            updated_at: row.3,
            payload: serde_json::from_str(&row.4)?,
        })).transpose()
    }

    pub fn archive_profile_site_worlds(
        &self,
        profile_id: &str,
        timestamp: &str,
    ) -> Result<usize, StorageError> {
        Ok(self.connection_guard()?.execute(
            "UPDATE site_worlds SET state='archived', archived_at=?2, updated_at=?2
             WHERE profile_id=?1 AND state='active'",
            params![profile_id, timestamp],
        )?)
    }

    pub fn activate_site_world(
        &self,
        profile_id: &str,
        id: &str,
        timestamp: &str,
    ) -> Result<bool, StorageError> {
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        let origin = transaction
            .query_row(
                "SELECT origin FROM site_worlds WHERE profile_id=?1 AND id=?2",
                params![profile_id, id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(origin) = origin else { return Ok(false); };
        transaction.execute(
            "UPDATE site_worlds SET state='archived', archived_at=?3, updated_at=?3
             WHERE profile_id=?1 AND origin=?2 AND state='active' AND id<>?4",
            params![profile_id, origin, timestamp, id],
        )?;
        transaction.execute(
            "UPDATE site_worlds SET state='active', archived_at=NULL, updated_at=?3
             WHERE profile_id=?1 AND origin=?2 AND id=?4",
            params![profile_id, origin, timestamp, id],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn delete_profile_data(&self, profile_id: &str) -> Result<usize, StorageError> {
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        let tables = [
            "artifacts",
            "generation_jobs",
            "site_worlds",
            "site_sessions",
            "page_summaries",
            "navigation_edges",
            "provider_connections",
            "settings",
            "usage_records",
            "cached_assets",
        ];
        let mut deleted = 0;
        for table in tables {
            deleted += transaction.execute(
                &format!("DELETE FROM {table} WHERE profile_id=?1"),
                [profile_id],
            )?;
        }
        transaction.commit()?;
        Ok(deleted)
    }

    pub fn mark_job_started(
        &self,
        job_id: &str,
        profile_id: &str,
        request: &Value,
    ) -> Result<(), StorageError> {
        let now = Utc::now().to_rfc3339();
        self.connection_guard()?.execute(
            "INSERT INTO generation_jobs
               (id, profile_id, status, request_payload, created_at, updated_at)
             VALUES (?1, ?2, 'queued', ?3, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET status='queued', request_payload=excluded.request_payload,
               updated_at=excluded.updated_at, error_payload=NULL",
            params![job_id, profile_id, serde_json::to_string(request)?, now],
        )?;
        Ok(())
    }

    pub fn update_job(
        &self,
        job_id: &str,
        status: &str,
        artifact_id: Option<&str>,
        error: Option<&Value>,
    ) -> Result<(), StorageError> {
        self.connection_guard()?.execute(
            "UPDATE generation_jobs SET status=?2, result_artifact_id=?3, error_payload=?4,
               updated_at=?5 WHERE id=?1",
            params![
                job_id,
                status,
                artifact_id,
                error.map(serde_json::to_string).transpose()?,
                Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn upsert_provider(&self, provider: &ProviderConnectionRecord) -> Result<(), StorageError> {
        self.connection_guard()?.execute(
            "INSERT INTO provider_connections
               (id, profile_id, kind, display_name, base_url, secret_ref, enabled, status,
                last_verified_at, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               profile_id=excluded.profile_id, kind=excluded.kind,
               display_name=excluded.display_name, base_url=excluded.base_url,
               secret_ref=excluded.secret_ref, enabled=excluded.enabled,
               status=excluded.status, last_verified_at=excluded.last_verified_at,
               payload=excluded.payload",
            params![
                provider.id,
                provider.profile_id,
                provider.kind,
                provider.display_name,
                provider.base_url,
                provider.secret_ref,
                provider.enabled,
                provider.status,
                provider.last_verified_at,
                serde_json::to_string(&provider.payload)?
            ],
        )?;
        Ok(())
    }

    pub fn list_providers(
        &self,
        profile_id: &str,
    ) -> Result<Vec<ProviderConnectionRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, kind, display_name, base_url, secret_ref, enabled,
                    status, last_verified_at, payload
             FROM provider_connections WHERE profile_id=?1 ORDER BY display_name",
        )?;
        let rows = statement.query_map([profile_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, String>(9)?,
            ))
        })?;
        rows.map(|row| {
            let row = row?;
            Ok(ProviderConnectionRecord {
                id: row.0,
                profile_id: row.1,
                kind: row.2,
                display_name: row.3,
                base_url: row.4,
                secret_ref: row.5,
                enabled: row.6,
                status: row.7,
                last_verified_at: row.8,
                payload: serde_json::from_str(&row.9)?,
            })
        })
        .collect()
    }

    pub fn delete_provider(&self, id: &str, profile_id: &str) -> Result<usize, StorageError> {
        Ok(self.connection_guard()?.execute(
            "DELETE FROM provider_connections WHERE id=?1 AND profile_id=?2",
            params![id, profile_id],
        )?)
    }

    pub fn update_provider_status(
        &self,
        id: &str,
        status: &str,
        last_verified_at: Option<&str>,
    ) -> Result<usize, StorageError> {
        Ok(self.connection_guard()?.execute(
            "UPDATE provider_connections SET status=?2, last_verified_at=?3 WHERE id=?1",
            params![id, status, last_verified_at],
        )?)
    }

    fn connection_guard(&self) -> Result<std::sync::MutexGuard<'_, Connection>, StorageError> {
        self.connection.lock().map_err(|_| StorageError::Poisoned)
    }
}

type ArtifactTuple = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

fn tuple_to_artifact(row: ArtifactTuple) -> Result<ArtifactRecord, StorageError> {
    Ok(ArtifactRecord {
        id: row.0,
        profile_id: row.1,
        site_id: row.2,
        url: row.3,
        title: row.4,
        html: row.5,
        created_at: row.6,
        payload: serde_json::from_str(&row.7)?,
    })
}

type SiteWorldTuple = (
    String,
    String,
    String,
    String,
    i64,
    String,
    String,
    Option<String>,
    String,
);

fn tuple_to_site_world(row: SiteWorldTuple) -> Result<SiteWorldRecord, StorageError> {
    Ok(SiteWorldRecord {
        id: row.0,
        profile_id: row.1,
        origin: row.2,
        state: row.3,
        revision: row.4,
        created_at: row.5,
        updated_at: row.6,
        archived_at: row.7,
        payload: serde_json::from_str(&row.8)?,
    })
}

fn migrate_site_world_incarnations(connection: &Connection) -> Result<(), StorageError> {
    let has_state = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('site_worlds') WHERE name='state')",
        [],
        |row| row.get::<_, bool>(0),
    )?;
    if !has_state {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            CREATE TABLE site_worlds_incarnations (
              id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL,
              origin TEXT NOT NULL,
              state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'archived')),
              revision INTEGER NOT NULL,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              archived_at TEXT
            );
            INSERT INTO site_worlds_incarnations
              (id, profile_id, origin, state, revision, payload, created_at, updated_at, archived_at)
            SELECT id, profile_id, origin, 'active', revision, payload, updated_at, updated_at, NULL
            FROM site_worlds;
            DROP TABLE site_worlds;
            ALTER TABLE site_worlds_incarnations RENAME TO site_worlds;
            COMMIT;
            "#,
        )?;
    }
    connection.execute_batch(
        r#"
        CREATE UNIQUE INDEX IF NOT EXISTS site_worlds_one_active_origin
          ON site_worlds(profile_id, origin) WHERE state='active';
        CREATE INDEX IF NOT EXISTS site_worlds_profile_updated
          ON site_worlds(profile_id, updated_at DESC);
        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
          VALUES (2, CURRENT_TIMESTAMP);
        "#,
    )?;
    Ok(())
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (1, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_profile_created
  ON artifacts(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_profile_url_created
  ON artifacts(profile_id, url, created_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_site_url
  ON artifacts(site_id, url);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL,
  request_payload TEXT NOT NULL,
  result_artifact_id TEXT,
  error_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_worlds (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'archived')),
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS site_sessions (
  profile_id TEXT NOT NULL,
  site_world_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(profile_id, site_world_id)
);

CREATE TABLE IF NOT EXISTS page_summaries (
  artifact_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  url TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS navigation_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  source_artifact_id TEXT,
  target_artifact_id TEXT,
  target_url TEXT NOT NULL,
  intent_payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  secret_ref TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  status TEXT NOT NULL,
  last_verified_at TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS providers_profile ON provider_connections(profile_id);

CREATE TABLE IF NOT EXISTS settings (
  profile_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(profile_id, key)
);

CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_assets (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL
);
"#;

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::protocol::SiteSessionRecord;
    use super::{ArtifactRecord, SiteWorldRecord, Storage};

    #[test]
    fn artifact_round_trip_uses_sqlite() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        let artifact = ArtifactRecord {
            id: "artifact-1".into(),
            profile_id: "personal".into(),
            site_id: "example".into(),
            url: "https://example.com/".into(),
            title: "Example".into(),
            html: "<!doctype html><title>Example</title>".into(),
            created_at: "2026-08-12T00:00:00Z".into(),
            payload: json!({"pipeline": ["page-director", "page-builder"]}),
        };
        storage.save_artifact(&artifact).unwrap();
        assert!(storage
            .artifact(&artifact.id, "another-profile")
            .unwrap()
            .is_none());
        let restored = storage
            .artifact(&artifact.id, &artifact.profile_id)
            .unwrap()
            .unwrap();
        assert_eq!(restored.url, artifact.url);
        assert_eq!(restored.payload, artifact.payload);
        assert!(storage
            .latest_artifact_for_url("another-profile", &artifact.site_id, &artifact.url)
            .unwrap()
            .is_none());
        assert_eq!(
            storage
                .latest_artifact_for_url(&artifact.profile_id, &artifact.site_id, &artifact.url)
                .unwrap()
                .unwrap()
                .id,
            artifact.id
        );

        let other_incarnation = ArtifactRecord {
            id: "artifact-2".into(),
            profile_id: artifact.profile_id.clone(),
            site_id: "example-reimagined".into(),
            url: artifact.url.clone(),
            title: artifact.title.clone(),
            html: artifact.html.clone(),
            created_at: "2026-08-12T00:00:01Z".into(),
            payload: artifact.payload.clone(),
        };
        storage.save_artifact(&other_incarnation).unwrap();
        assert_eq!(
            storage
                .latest_artifact_for_url(&artifact.profile_id, &artifact.site_id, &artifact.url)
                .unwrap()
                .unwrap()
                .id,
            artifact.id
        );
    }

    #[test]
    fn site_session_is_profile_scoped_revisioned_and_bounded() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        let initial = SiteSessionRecord {
            profile_id: "personal".into(),
            site_world_id: "site-1".into(),
            revision: 2,
            updated_at: "2026-08-20T00:00:00Z".into(),
            payload: json!({"cart":{"items":{}},"wishlist":[],"values":{},"regionSnapshots":{}}),
        };
        assert!(storage.upsert_site_session(&initial).unwrap());
        assert!(storage.site_session("other", "site-1").unwrap().is_none());
        assert_eq!(storage.site_session("personal", "site-1").unwrap().unwrap().revision, 2);
        let stale = SiteSessionRecord { revision: 1, payload: json!({"stale":true}), ..initial };
        assert!(!storage.upsert_site_session(&stale).unwrap());
        assert_eq!(storage.site_session("personal", "site-1").unwrap().unwrap().revision, 2);
    }

    #[test]
    fn site_world_crud_is_profile_scoped_and_revision_guarded() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        let initial = SiteWorldRecord {
            id: "site-example-v1".into(),
            profile_id: "personal".into(),
            origin: "https://example.com".into(),
            state: "active".into(),
            revision: 1,
            created_at: "2026-08-12T00:00:00Z".into(),
            updated_at: "2026-08-12T00:00:01Z".into(),
            archived_at: None,
            payload: json!({"name": "Example", "revision": 1}),
        };
        assert!(storage.upsert_site_world(&initial).unwrap());
        assert!(storage
            .site_world(&initial.id, "another-profile")
            .unwrap()
            .is_none());
        assert_eq!(
            storage
                .site_world(&initial.id, "personal")
                .unwrap()
                .unwrap()
                .payload,
            initial.payload
        );

        let updated = SiteWorldRecord {
            id: "site-example-v2".into(),
            revision: 2,
            updated_at: "2026-08-12T00:00:02Z".into(),
            payload: json!({"name": "Example revised", "revision": 2}),
            ..initial
        };
        assert!(storage.upsert_site_world(&updated).unwrap());
        assert_eq!(
            storage
                .site_world("site-example-v1", "personal")
                .unwrap()
                .unwrap()
                .state,
            "archived"
        );

        let stale = SiteWorldRecord {
            revision: 1,
            updated_at: "2026-08-12T00:00:03Z".into(),
            payload: json!({"name": "Stale"}),
            ..updated
        };
        assert!(!storage.upsert_site_world(&stale).unwrap());
        let worlds = storage.list_site_worlds("personal", 500).unwrap();
        assert_eq!(worlds.len(), 2);
        let active = worlds.iter().find(|world| world.state == "active").unwrap();
        assert_eq!(active.revision, 2);
        assert_eq!(active.payload["name"], "Example revised");
        assert!(storage
            .activate_site_world("personal", "site-example-v1", "2026-08-12T00:00:04Z")
            .unwrap());
        assert_eq!(
            storage
                .site_world("site-example-v1", "personal")
                .unwrap()
                .unwrap()
                .state,
            "active"
        );
        assert_eq!(
            storage
                .site_world("site-example-v2", "personal")
                .unwrap()
                .unwrap()
                .state,
            "archived"
        );
        assert_eq!(
            storage
                .delete_site_world(&stale.id, "another-profile")
                .unwrap(),
            0
        );
        assert_eq!(storage.delete_site_world(&stale.id, "personal").unwrap(), 1);
        assert_eq!(storage.delete_site_world(&initial.id, "personal").unwrap(), 1);
        assert!(storage
            .list_site_worlds("personal", 500)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn legacy_site_worlds_migrate_to_active_incarnations() {
        let path = std::env::temp_dir().join(format!(
            "vibesurfer-site-world-migration-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        {
            let connection = rusqlite::Connection::open(&path).unwrap();
            connection.execute_batch(
                r#"
                CREATE TABLE site_worlds (
                  id TEXT PRIMARY KEY,
                  profile_id TEXT NOT NULL,
                  origin TEXT NOT NULL,
                  revision INTEGER NOT NULL,
                  payload TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  UNIQUE(profile_id, origin)
                );
                INSERT INTO site_worlds (id, profile_id, origin, revision, payload, updated_at)
                VALUES ('legacy-site', 'personal', 'https://legacy.example', 4, '{"name":"Legacy"}', '2026-08-12T00:00:00Z');
                "#,
            ).unwrap();
        }

        let storage = Storage::open(&path).unwrap();
        let migrated = storage.site_world("legacy-site", "personal").unwrap().unwrap();
        assert_eq!(migrated.state, "active");
        assert_eq!(migrated.created_at, "2026-08-12T00:00:00Z");
        let replacement = SiteWorldRecord {
            id: "replacement-site".into(),
            profile_id: "personal".into(),
            origin: "https://legacy.example".into(),
            state: "active".into(),
            revision: 1,
            created_at: "2026-08-12T00:00:01Z".into(),
            updated_at: "2026-08-12T00:00:01Z".into(),
            archived_at: None,
            payload: json!({"name": "Replacement"}),
        };
        assert!(storage.upsert_site_world(&replacement).unwrap());
        assert_eq!(
            storage.site_world("legacy-site", "personal").unwrap().unwrap().state,
            "archived"
        );
        drop(storage);
        std::fs::remove_file(path).unwrap();
    }
}
