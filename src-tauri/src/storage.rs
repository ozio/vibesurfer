use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::protocol::{
    ArtifactRecord, ArtifactSummary, ArtifactSummaryPage, BrowsingHistoryPage,
    BrowsingHistoryRecord, GenerationActivityDetail, GenerationJobEventRecord, GenerationJobPage,
    GenerationJobRecord, GenerationStageRecord, MediaConnectionRecord, ProviderConnectionRecord,
    SiteSessionActionRequest, SiteSessionPatchRequest, SiteSessionRecord, SiteWorldRecord,
};

const MAX_ARTIFACT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SITE_WORLD_BYTES: usize = 1024 * 1024;
const MAX_SITE_SESSION_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy)]
pub(crate) struct GenerationStageWrite<'a> {
    pub job_id: &'a str,
    pub profile_id: &'a str,
    pub stage: &'a str,
    pub status: &'a str,
    pub started_at: &'a str,
    pub completed_at: Option<&'a str>,
    pub payload: &'a Value,
}

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
    #[error("storage actor is unavailable: {0}")]
    ActorUnavailable(String),
}

type StorageTask = Box<dyn FnOnce(&Storage) + Send + 'static>;

#[derive(Clone)]
pub struct StorageHandle {
    sender: mpsc::Sender<StorageTask>,
    queue_depth: Arc<AtomicUsize>,
}

impl StorageHandle {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        let storage = Storage::open(path)?;
        let (sender, receiver) = mpsc::channel::<StorageTask>();
        thread::Builder::new()
            .name("vibesurfer-storage".into())
            .spawn(move || {
                while let Ok(task) = receiver.recv() {
                    task(&storage);
                }
            })
            .map_err(|error| StorageError::ActorUnavailable(error.to_string()))?;
        Ok(Self {
            sender,
            queue_depth: Arc::new(AtomicUsize::new(0)),
        })
    }

    pub async fn run<T, F>(&self, operation: F) -> Result<T, StorageError>
    where
        T: Send + 'static,
        F: FnOnce(&Storage) -> Result<T, StorageError> + Send + 'static,
    {
        let (reply, result) = tokio::sync::oneshot::channel();
        let queue_depth = self.queue_depth.clone();
        queue_depth.fetch_add(1, Ordering::Relaxed);
        let task = Box::new(move |storage: &Storage| {
            let outcome =
                catch_unwind(AssertUnwindSafe(|| operation(storage))).unwrap_or_else(|_| {
                    Err(StorageError::ActorUnavailable(
                        "storage task panicked".into(),
                    ))
                });
            queue_depth.fetch_sub(1, Ordering::Relaxed);
            let _ = reply.send(outcome);
        });
        if self.sender.send(task).is_err() {
            self.queue_depth.fetch_sub(1, Ordering::Relaxed);
            return Err(StorageError::ActorUnavailable(
                "storage thread stopped".into(),
            ));
        }
        result
            .await
            .map_err(|_| StorageError::ActorUnavailable("storage reply channel closed".into()))?
    }

    pub fn queue_depth(&self) -> usize {
        self.queue_depth.load(Ordering::Relaxed)
    }
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
        let should_vacuum = apply_performance_migrations(&connection)?;
        if should_vacuum {
            let _ = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn save_artifact(&self, artifact: &ArtifactRecord) -> Result<(), StorageError> {
        if artifact.html.len() > MAX_ARTIFACT_BYTES {
            return Err(StorageError::ArtifactTooLarge);
        }
        let (payload, exchanges) = persisted_artifact_payload(artifact)?;
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        transaction.execute(
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
        for exchange in exchanges {
            upsert_generation_stage_on(
                &transaction,
                GenerationStageWrite {
                    job_id: &exchange.job_id,
                    profile_id: &artifact.profile_id,
                    stage: &exchange.stage,
                    status: "completed",
                    started_at: &exchange.started_at,
                    completed_at: exchange.completed_at.as_deref(),
                    payload: &exchange.payload,
                },
            )?;
        }
        transaction.commit()?;
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

    pub fn artifacts_by_ids(
        &self,
        profile_id: &str,
        ids: &[String],
    ) -> Result<Vec<ArtifactRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, site_id, url, title, html, created_at, payload
             FROM artifacts WHERE profile_id = ?1 AND id = ?2",
        )?;
        let mut artifacts = Vec::new();
        for id in ids.iter().filter(|id| !id.is_empty()).take(64) {
            let row = statement
                .query_row(params![profile_id, id], |row| {
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
                })
                .optional()?;
            if let Some(row) = row {
                artifacts.push(tuple_to_artifact(row)?);
            }
        }
        Ok(artifacts)
    }

    pub fn artifact_summaries(
        &self,
        profile_id: &str,
        limit: usize,
        cursor: Option<&str>,
    ) -> Result<ArtifactSummaryPage, StorageError> {
        let limit = limit.clamp(1, 100);
        let cursor = cursor.map(decode_cursor).transpose()?;
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, site_id, url, title, created_at
             FROM artifacts
             WHERE profile_id=?1
               AND (?2 IS NULL OR created_at < ?2 OR (created_at = ?2 AND id < ?3))
             ORDER BY created_at DESC, id DESC LIMIT ?4",
        )?;
        let rows = statement.query_map(
            params![
                profile_id,
                cursor.as_ref().map(|value| value.at.as_str()),
                cursor.as_ref().map(|value| value.id.as_str()),
                (limit + 1) as i64,
            ],
            |row| {
                Ok(ArtifactSummary {
                    id: row.get(0)?,
                    profile_id: row.get(1)?,
                    site_id: row.get(2)?,
                    url: row.get(3)?,
                    title: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )?;
        let mut items = rows.collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if items.len() > limit {
            items.truncate(limit);
            items
                .last()
                .map(|item| encode_cursor(&item.created_at, &item.id))
                .transpose()?
        } else {
            None
        };
        Ok(ArtifactSummaryPage { items, next_cursor })
    }

    pub fn delete_profile_artifacts(&self, profile_id: &str) -> Result<usize, StorageError> {
        Ok(self
            .connection_guard()?
            .execute("DELETE FROM artifacts WHERE profile_id = ?1", [profile_id])?)
    }

    pub fn upsert_browsing_history(
        &self,
        records: &[BrowsingHistoryRecord],
    ) -> Result<usize, StorageError> {
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        let mut changed = 0;
        for record in records.iter().take(500) {
            changed += transaction.execute(
                "INSERT INTO browsing_history
                   (id, profile_id, url, title, status, opened_at, updated_at, favicon,
                    artifact_id, generation_job_id, error_message)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                   profile_id=excluded.profile_id, url=excluded.url, title=excluded.title,
                   status=excluded.status, opened_at=excluded.opened_at,
                   updated_at=excluded.updated_at, favicon=excluded.favicon,
                   artifact_id=excluded.artifact_id,
                   generation_job_id=excluded.generation_job_id,
                   error_message=excluded.error_message
                 WHERE excluded.updated_at >= browsing_history.updated_at",
                params![
                    record.id,
                    record.profile_id,
                    record.url,
                    record.title,
                    record.status,
                    record.opened_at,
                    record.updated_at,
                    record
                        .favicon
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()?,
                    record.artifact_id,
                    record.generation_job_id,
                    record.error_message,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(changed)
    }

    pub fn browsing_history(
        &self,
        profile_id: &str,
        limit: usize,
        cursor: Option<&str>,
    ) -> Result<BrowsingHistoryPage, StorageError> {
        let limit = limit.clamp(1, 100);
        let cursor = cursor.map(decode_cursor).transpose()?;
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, url, title, status, opened_at, updated_at, favicon,
                    artifact_id, generation_job_id, error_message
             FROM browsing_history
             WHERE profile_id=?1
               AND (?2 IS NULL OR opened_at < ?2 OR (opened_at = ?2 AND id < ?3))
             ORDER BY opened_at DESC, id DESC LIMIT ?4",
        )?;
        let rows = statement.query_map(
            params![
                profile_id,
                cursor.as_ref().map(|value| value.at.as_str()),
                cursor.as_ref().map(|value| value.id.as_str()),
                (limit + 1) as i64,
            ],
            |row| {
                let favicon = row
                    .get::<_, Option<String>>(7)?
                    .map(|value| parse_json_column(value, 7))
                    .transpose()?;
                Ok(BrowsingHistoryRecord {
                    id: row.get(0)?,
                    profile_id: row.get(1)?,
                    url: row.get(2)?,
                    title: row.get(3)?,
                    status: row.get(4)?,
                    opened_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    favicon,
                    artifact_id: row.get(8)?,
                    generation_job_id: row.get(9)?,
                    error_message: row.get(10)?,
                })
            },
        )?;
        let mut items = rows.collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if items.len() > limit {
            items.truncate(limit);
            items
                .last()
                .map(|item| encode_cursor(&item.opened_at, &item.id))
                .transpose()?
        } else {
            None
        };
        Ok(BrowsingHistoryPage { items, next_cursor })
    }

    pub fn delete_browsing_history_entry(
        &self,
        profile_id: &str,
        id: &str,
    ) -> Result<usize, StorageError> {
        Ok(self.connection_guard()?.execute(
            "DELETE FROM browsing_history WHERE profile_id=?1 AND id=?2",
            params![profile_id, id],
        )?)
    }

    pub fn clear_browsing_history(&self, profile_id: &str) -> Result<usize, StorageError> {
        Ok(self.connection_guard()?.execute(
            "DELETE FROM browsing_history WHERE profile_id=?1",
            [profile_id],
        )?)
    }

    pub fn upsert_site_world(&self, site_world: &SiteWorldRecord) -> Result<bool, StorageError> {
        if site_world.revision < 0 {
            return Err(StorageError::InvalidSiteWorldRevision);
        }
        if site_world.state != "active" && site_world.state != "archived" {
            return Err(StorageError::Database(
                rusqlite::Error::InvalidParameterName(
                    "site world state must be active or archived".into(),
                ),
            ));
        }
        let payload = serde_json::to_string(&site_world.payload)?;
        if payload.len() > MAX_SITE_WORLD_BYTES {
            return Err(StorageError::SiteWorldTooLarge);
        }

        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        let existing_revision = transaction
            .query_row(
                "SELECT revision FROM site_worlds WHERE profile_id=?1 AND id=?2",
                params![site_world.profile_id, site_world.id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        if existing_revision.is_some_and(|revision| revision > site_world.revision) {
            return Ok(false);
        }

        if site_world.state == "active" {
            transaction.execute(
                "UPDATE site_worlds SET state='archived', archived_at=?3, updated_at=?3
                 WHERE profile_id=?1 AND origin=?2 AND state='active' AND id<>?4",
                params![
                    site_world.profile_id,
                    site_world.origin,
                    site_world.updated_at,
                    site_world.id
                ],
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
        transaction.execute(
            "DELETE FROM site_sessions WHERE profile_id=?1",
            [profile_id],
        )?;
        let deleted =
            transaction.execute("DELETE FROM site_worlds WHERE profile_id=?1", [profile_id])?;
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
            params![
                session.profile_id,
                session.site_world_id,
                session.revision,
                session.updated_at,
                payload
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn site_session(
        &self,
        profile_id: &str,
        site_world_id: &str,
    ) -> Result<Option<SiteSessionRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let row = connection
            .query_row(
                "SELECT profile_id, site_world_id, revision, updated_at, payload
             FROM site_sessions WHERE profile_id=?1 AND site_world_id=?2",
                params![profile_id, site_world_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;
        row.map(|row| {
            Ok(SiteSessionRecord {
                profile_id: row.0,
                site_world_id: row.1,
                revision: row.2,
                updated_at: row.3,
                payload: serde_json::from_str(&row.4)?,
            })
        })
        .transpose()
    }

    pub fn apply_site_session_action(
        &self,
        request: &SiteSessionActionRequest,
    ) -> Result<SiteSessionRecord, StorageError> {
        validate_session_scope(&request.profile_id, &request.site_world_id)?;
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        let mut session =
            site_session_on(&transaction, &request.profile_id, &request.site_world_id)?
                .unwrap_or_else(|| empty_site_session(&request.profile_id, &request.site_world_id));
        if mutate_site_session_action(&mut session.payload, request)? {
            commit_site_session_on(&transaction, &mut session)?;
        }
        transaction.commit()?;
        Ok(session)
    }

    pub fn apply_site_session_patches(
        &self,
        request: &SiteSessionPatchRequest,
    ) -> Result<SiteSessionRecord, StorageError> {
        validate_session_scope(&request.profile_id, &request.site_world_id)?;
        let mut connection = self.connection_guard()?;
        let transaction = connection.transaction()?;
        let mut session =
            site_session_on(&transaction, &request.profile_id, &request.site_world_id)?
                .unwrap_or_else(|| empty_site_session(&request.profile_id, &request.site_world_id));
        if mutate_site_session_patches(&mut session.payload, request)? {
            commit_site_session_on(&transaction, &mut session)?;
        }
        transaction.commit()?;
        Ok(session)
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
        let Some(origin) = origin else {
            return Ok(false);
        };
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
            "generation_job_events",
            "generation_stage_records",
            "generation_jobs",
            "site_worlds",
            "site_sessions",
            "page_summaries",
            "navigation_edges",
            "provider_connections",
            "media_connections",
            "settings",
            "usage_records",
            "cached_assets",
            "browsing_history",
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
        let request = generation_request_summary(request);
        self.connection_guard()?.execute(
            "INSERT INTO generation_jobs
               (id, profile_id, status, request_payload, created_at, updated_at)
             VALUES (?1, ?2, 'queued', ?3, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET status='queued', request_payload=excluded.request_payload,
               updated_at=excluded.updated_at, error_payload=NULL",
            params![job_id, profile_id, serde_json::to_string(&request)?, now],
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

    pub fn record_job_event(
        &self,
        job_id: &str,
        profile_id: &str,
        event_type: &str,
        sequence: Option<i64>,
        timestamp: &str,
        payload: &Value,
    ) -> Result<(), StorageError> {
        if matches!(
            event_type,
            "generation.progress"
                | "generation.metadata"
                | "generation.preview"
                | "generation.stage"
        ) {
            return Ok(());
        }
        let payload = compact_event_payload(event_type, payload);
        let serialized = bounded_json(&bounded_activity_payload(&payload), 64 * 1024);
        self.connection_guard()?.execute(
            "INSERT INTO generation_job_events
               (job_id, profile_id, event_type, sequence, timestamp, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![job_id, profile_id, event_type, sequence, timestamp, serialized],
        )?;
        Ok(())
    }

    pub fn upsert_generation_stage(
        &self,
        stage: GenerationStageWrite<'_>,
    ) -> Result<(), StorageError> {
        let connection = self.connection_guard()?;
        upsert_generation_stage_on(&connection, stage)
    }

    pub fn generation_job_page(
        &self,
        profile_id: &str,
        limit: usize,
        cursor: Option<&str>,
    ) -> Result<GenerationJobPage, StorageError> {
        let limit = limit.clamp(1, 50);
        let cursor = cursor.map(decode_cursor).transpose()?;
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, status, request_payload, result_artifact_id,
                    error_payload, created_at, updated_at
             FROM generation_jobs
             WHERE profile_id=?1
               AND (?2 IS NULL OR created_at < ?2 OR (created_at = ?2 AND id < ?3))
             ORDER BY created_at DESC, id DESC LIMIT ?4",
        )?;
        let rows = statement.query_map(
            params![
                profile_id,
                cursor.as_ref().map(|value| value.at.as_str()),
                cursor.as_ref().map(|value| value.id.as_str()),
                (limit + 1) as i64,
            ],
            generation_job_from_row,
        )?;
        let mut items = rows.collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if items.len() > limit {
            items.truncate(limit);
            items
                .last()
                .map(|item| encode_cursor(&item.created_at, &item.id))
                .transpose()?
        } else {
            None
        };
        Ok(GenerationJobPage { items, next_cursor })
    }

    pub fn generation_activity(
        &self,
        profile_id: &str,
        job_id: &str,
    ) -> Result<Option<GenerationActivityDetail>, StorageError> {
        let connection = self.connection_guard()?;
        let job = connection
            .query_row(
                "SELECT id, profile_id, status, request_payload, result_artifact_id,
                    error_payload, created_at, updated_at
             FROM generation_jobs WHERE profile_id=?1 AND id=?2",
                params![profile_id, job_id],
                generation_job_from_row,
            )
            .optional()?;
        let Some(job) = job else {
            return Ok(None);
        };

        let mut event_statement = connection.prepare(
            "SELECT id, job_id, event_type, sequence, timestamp, payload
             FROM generation_job_events WHERE profile_id=?1 AND job_id=?2
             ORDER BY id ASC",
        )?;
        let events = event_statement
            .query_map(params![profile_id, job_id], |row| {
                Ok(GenerationJobEventRecord {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    event_type: row.get(2)?,
                    sequence: row.get(3)?,
                    timestamp: row.get(4)?,
                    payload: parse_json_column(row.get::<_, String>(5)?, 5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut stage_statement = connection.prepare(
            "SELECT job_id, stage, status, started_at, completed_at, payload
             FROM generation_stage_records WHERE profile_id=?1 AND job_id=?2
             ORDER BY started_at ASC, stage ASC",
        )?;
        let stages = stage_statement
            .query_map(params![profile_id, job_id], |row| {
                Ok(GenerationStageRecord {
                    job_id: row.get(0)?,
                    stage: row.get(1)?,
                    status: row.get(2)?,
                    started_at: row.get(3)?,
                    completed_at: row.get(4)?,
                    payload: parse_json_column(row.get::<_, String>(5)?, 5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Some(GenerationActivityDetail {
            job,
            events,
            stages,
        }))
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

    pub fn upsert_media_connection(
        &self,
        connection: &MediaConnectionRecord,
    ) -> Result<(), StorageError> {
        self.connection_guard()?.execute(
            "INSERT INTO media_connections
               (id, profile_id, provider, display_name, secret_ref, status, last_verified_at, voices)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(profile_id, id) DO UPDATE SET
               provider=excluded.provider, display_name=excluded.display_name,
               secret_ref=excluded.secret_ref, status=excluded.status,
               last_verified_at=excluded.last_verified_at, voices=excluded.voices",
            params![
                connection.id,
                connection.profile_id,
                connection.provider,
                connection.display_name,
                connection.secret_ref,
                connection.status,
                connection.last_verified_at,
                serde_json::to_string(&connection.voices)?,
            ],
        )?;
        Ok(())
    }

    pub fn list_media_connections(
        &self,
        profile_id: &str,
    ) -> Result<Vec<MediaConnectionRecord>, StorageError> {
        let connection = self.connection_guard()?;
        let mut statement = connection.prepare(
            "SELECT id, profile_id, provider, display_name, secret_ref, status, last_verified_at, voices
             FROM media_connections WHERE profile_id=?1 ORDER BY display_name",
        )?;
        let rows = statement.query_map([profile_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;
        rows.map(|row| {
            let row = row?;
            Ok(MediaConnectionRecord {
                id: row.0,
                profile_id: row.1,
                provider: row.2,
                display_name: row.3,
                secret_ref: row.4,
                status: row.5,
                last_verified_at: row.6,
                voices: serde_json::from_str(&row.7)?,
            })
        })
        .collect()
    }

    pub fn media_connection(
        &self,
        profile_id: &str,
        id: &str,
    ) -> Result<Option<MediaConnectionRecord>, StorageError> {
        Ok(self
            .list_media_connections(profile_id)?
            .into_iter()
            .find(|connection| connection.id == id))
    }

    pub fn delete_media_connection(
        &self,
        profile_id: &str,
        id: &str,
    ) -> Result<usize, StorageError> {
        Ok(self.connection_guard()?.execute(
            "DELETE FROM media_connections WHERE profile_id=?1 AND id=?2",
            params![profile_id, id],
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

#[derive(Debug, Deserialize, Serialize)]
struct PageCursor {
    at: String,
    id: String,
}

fn encode_cursor(at: &str, id: &str) -> Result<String, StorageError> {
    Ok(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&PageCursor {
        at: at.to_owned(),
        id: id.to_owned(),
    })?))
}

fn decode_cursor(value: &str) -> Result<PageCursor, StorageError> {
    let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|error| {
        StorageError::Json(serde_json::Error::io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            error,
        )))
    })?;
    let cursor: PageCursor = serde_json::from_slice(&decoded)?;
    if cursor.at.is_empty()
        || cursor.id.is_empty()
        || cursor.at.len() > 128
        || cursor.id.len() > 256
    {
        return Err(StorageError::Json(serde_json::Error::io(
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid storage cursor"),
        )));
    }
    Ok(cursor)
}

struct PersistedExchange {
    job_id: String,
    stage: String,
    started_at: String,
    completed_at: Option<String>,
    payload: Value,
}

fn persisted_artifact_payload(
    artifact: &ArtifactRecord,
) -> Result<(String, Vec<PersistedExchange>), StorageError> {
    let mut payload = artifact.payload.clone();
    let job_id = payload
        .get("generationId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let exchanges = payload
        .as_object_mut()
        .and_then(|object| object.remove("modelExchanges"))
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .take(8)
        .filter_map(|exchange| {
            if job_id.is_empty() {
                return None;
            }
            let stage = exchange.get("purpose")?.as_str()?.to_owned();
            let started_at = exchange
                .get("startedAt")
                .and_then(Value::as_str)
                .unwrap_or(&artifact.created_at)
                .to_owned();
            let completed_at = exchange
                .get("completedAt")
                .and_then(Value::as_str)
                .map(str::to_owned);
            Some(PersistedExchange {
                job_id: job_id.clone(),
                stage,
                started_at,
                completed_at,
                payload: exchange,
            })
        })
        .collect();
    Ok((serde_json::to_string(&payload)?, exchanges))
}

fn upsert_generation_stage_on(
    connection: &Connection,
    stage: GenerationStageWrite<'_>,
) -> Result<(), StorageError> {
    let serialized = bounded_json(&bounded_activity_payload(stage.payload), 512 * 1024);
    connection.execute(
        "INSERT INTO generation_stage_records
           (job_id, profile_id, stage, status, started_at, completed_at, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(job_id, stage) DO UPDATE SET
           status=excluded.status, completed_at=excluded.completed_at, payload=excluded.payload",
        params![
            stage.job_id,
            stage.profile_id,
            stage.stage,
            stage.status,
            stage.started_at,
            stage.completed_at,
            serialized
        ],
    )?;
    Ok(())
}

fn generation_request_summary(request: &Value) -> Value {
    let provider = request
        .get("provider")
        .and_then(Value::as_object)
        .map(|provider| {
            serde_json::json!({
                "id": provider.get("id").or_else(|| provider.get("connectionId")),
                "kind": provider.get("kind"),
                "modelId": provider.get("modelId"),
                "generationMode": provider.get("generationMode"),
            })
        });
    serde_json::json!({
        "kind": request.get("kind"),
        "url": request.get("url"),
        "siteWorldId": request.get("siteWorldId"),
        "purpose": request.get("purpose"),
        "provider": provider,
        "browserTheme": request.get("browserTheme"),
        "settings": request.get("settings").and_then(|settings| settings.get("strategy")).map(|strategy| serde_json::json!({"strategy": strategy})),
        "navigationIntent": request.pointer("/context/navigationIntent").or_else(|| request.get("navigationIntent")),
        "discovery": request.get("discovery"),
        "action": request.get("action").and_then(|action| action.as_object()).map(|action| serde_json::json!({
            "action": action.get("action"),
            "trigger": action.get("trigger"),
            "targets": action.get("targets"),
        })),
    })
}

fn compact_event_payload(event_type: &str, payload: &Value) -> Value {
    let common = || {
        serde_json::json!({
            "type": event_type,
            "jobId": payload.get("jobId"),
            "requestId": payload.get("requestId"),
            "sequence": payload.get("sequence"),
            "at": payload.get("at").or_else(|| payload.get("timestamp")),
        })
    };
    match event_type {
        "generation.completed" => {
            let mut result = common();
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "artifactId".into(),
                    payload
                        .pointer("/artifact/id")
                        .cloned()
                        .unwrap_or(Value::Null),
                );
                object.insert(
                    "usage".into(),
                    payload.get("usage").cloned().unwrap_or(Value::Null),
                );
            }
            result
        }
        "dynamic.completed" => {
            let mut result = common();
            if let Some(object) = result.as_object_mut() {
                object.insert(
                    "usage".into(),
                    payload.get("usage").cloned().unwrap_or(Value::Null),
                );
                object.insert(
                    "patchCount".into(),
                    Value::from(
                        payload
                            .pointer("/result/patches")
                            .and_then(Value::as_array)
                            .map(Vec::len)
                            .unwrap_or(0),
                    ),
                );
            }
            result
        }
        _ => payload.clone(),
    }
}

fn bounded_json(value: &Value, max_bytes: usize) -> String {
    let serialized = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
    if serialized.len() <= max_bytes {
        return serialized;
    }
    let preview_limit = max_bytes.saturating_sub(256).min(64 * 1024);
    let preview: String = serialized.chars().take(preview_limit).collect();
    serde_json::to_string(&serde_json::json!({
        "truncated": true,
        "originalBytes": serialized.len(),
        "sha256": format!("{:x}", Sha256::digest(serialized.as_bytes())),
        "preview": preview,
    }))
    .unwrap_or_else(|_| "{\"truncated\":true}".into())
}

fn bounded_activity_payload(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let limit = match key.as_str() {
                        "prompt" | "systemPrompt" => Some(256 * 1024),
                        "response" => Some(256 * 1024),
                        _ => None,
                    };
                    let bounded = match (limit, value) {
                        (Some(limit), Value::String(text)) if text.len() > limit => {
                            Value::Object(serde_json::Map::from_iter([
                                ("truncated".into(), Value::Bool(true)),
                                ("originalBytes".into(), Value::Number(text.len().into())),
                                (
                                    "sha256".into(),
                                    Value::String(format!("{:x}", Sha256::digest(text.as_bytes()))),
                                ),
                                (
                                    "preview".into(),
                                    Value::String(
                                        text.chars().take(limit.min(64 * 1024)).collect(),
                                    ),
                                ),
                            ]))
                        }
                        _ => bounded_activity_payload(value),
                    };
                    (key.clone(), bounded)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(bounded_activity_payload).collect()),
        _ => value.clone(),
    }
}

fn parse_json_column(value: String, column: usize) -> Result<Value, rusqlite::Error> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(column, Type::Text, Box::new(error))
    })
}

fn generation_job_from_row(row: &Row<'_>) -> Result<GenerationJobRecord, rusqlite::Error> {
    let request_payload = parse_json_column(row.get::<_, String>(3)?, 3)?;
    let error_payload = row
        .get::<_, Option<String>>(5)?
        .map(|value| parse_json_column(value, 5))
        .transpose()?;
    Ok(GenerationJobRecord {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        status: row.get(2)?,
        request_payload,
        result_artifact_id: row.get(4)?,
        error_payload,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
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

fn session_parameter_error(message: &str) -> StorageError {
    StorageError::Database(rusqlite::Error::InvalidParameterName(message.into()))
}

fn validate_session_scope(profile_id: &str, site_world_id: &str) -> Result<(), StorageError> {
    let valid = |value: &str| {
        !value.is_empty()
            && value.len() <= 160
            && value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':')
            })
    };
    if !valid(profile_id) || !valid(site_world_id) {
        return Err(session_parameter_error("invalid site session scope"));
    }
    Ok(())
}

fn empty_site_session(profile_id: &str, site_world_id: &str) -> SiteSessionRecord {
    let updated_at = "1970-01-01T00:00:00.000Z".to_owned();
    SiteSessionRecord {
        profile_id: profile_id.to_owned(),
        site_world_id: site_world_id.to_owned(),
        revision: 0,
        updated_at: updated_at.clone(),
        payload: serde_json::json!({
            "profileId": profile_id,
            "siteWorldId": site_world_id,
            "revision": 0,
            "cart": { "items": {} },
            "wishlist": [],
            "values": {},
            "regionSnapshots": {},
            "updatedAt": updated_at,
        }),
    }
}

fn site_session_on(
    transaction: &Transaction<'_>,
    profile_id: &str,
    site_world_id: &str,
) -> Result<Option<SiteSessionRecord>, StorageError> {
    let row = transaction.query_row(
        "SELECT revision, updated_at, payload FROM site_sessions WHERE profile_id=?1 AND site_world_id=?2",
        params![profile_id, site_world_id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
    ).optional()?;
    row.map(|(revision, updated_at, payload)| {
        Ok(SiteSessionRecord {
            profile_id: profile_id.to_owned(),
            site_world_id: site_world_id.to_owned(),
            revision,
            updated_at,
            payload: serde_json::from_str(&payload)?,
        })
    })
    .transpose()
}

fn commit_site_session_on(
    transaction: &Transaction<'_>,
    session: &mut SiteSessionRecord,
) -> Result<(), StorageError> {
    session.revision = session.revision.saturating_add(1);
    session.updated_at = Utc::now().to_rfc3339();
    let object = session
        .payload
        .as_object_mut()
        .ok_or_else(|| session_parameter_error("site session payload must be an object"))?;
    object.insert(
        "profileId".into(),
        Value::String(session.profile_id.clone()),
    );
    object.insert(
        "siteWorldId".into(),
        Value::String(session.site_world_id.clone()),
    );
    object.insert("revision".into(), Value::from(session.revision));
    object.insert(
        "updatedAt".into(),
        Value::String(session.updated_at.clone()),
    );
    fit_site_session(&mut session.payload)?;
    let payload = serde_json::to_string(&session.payload)?;
    if payload.len() > MAX_SITE_SESSION_BYTES {
        return Err(StorageError::SiteSessionTooLarge);
    }
    transaction.execute(
        "INSERT INTO site_sessions (profile_id, site_world_id, revision, updated_at, payload)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(profile_id, site_world_id) DO UPDATE SET
           revision=excluded.revision, updated_at=excluded.updated_at, payload=excluded.payload",
        params![
            session.profile_id,
            session.site_world_id,
            session.revision,
            session.updated_at,
            payload
        ],
    )?;
    Ok(())
}

fn mutate_site_session_action(
    payload: &mut Value,
    request: &SiteSessionActionRequest,
) -> Result<bool, StorageError> {
    if request.fields.len() > 64
        || request.fields.iter().any(|(key, values)| {
            key.len() > 80 || values.len() > 32 || values.iter().any(|value| value.len() > 16_384)
        })
    {
        return Err(session_parameter_error(
            "site session action fields exceed limits",
        ));
    }
    let field = |name: &str| {
        request
            .fields
            .get(name)
            .and_then(|values| values.first())
            .map(|value| value.trim())
    };
    let product_id = field("productId")
        .map(|value| value.chars().take(160).collect::<String>())
        .filter(|value| !value.is_empty());
    let root = payload
        .as_object_mut()
        .ok_or_else(|| session_parameter_error("site session payload must be an object"))?;
    match request.action.to_ascii_lowercase().as_str() {
        "state:cart.add" => {
            let Some(product_id) = product_id else {
                return Ok(false);
            };
            let quantity = positive_session_integer(field("quantity")).unwrap_or(1);
            let items = nested_object_mut(root, "cart", "items");
            let existing = items.get(&product_id).cloned();
            let current_quantity = existing
                .as_ref()
                .and_then(|item| item.get("quantity"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let mut item = serde_json::Map::from_iter([
                ("productId".into(), Value::String(product_id.clone())),
                (
                    "quantity".into(),
                    Value::from(current_quantity.saturating_add(quantity).min(1_000_000)),
                ),
            ]);
            copy_or_set_price(
                &mut item,
                existing.as_ref(),
                field("unitPriceMinor"),
                field("currency"),
            );
            items.insert(product_id, Value::Object(item));
            Ok(true)
        }
        "state:cart.remove" => {
            let Some(product_id) = product_id else {
                return Ok(false);
            };
            Ok(nested_object_mut(root, "cart", "items")
                .remove(&product_id)
                .is_some())
        }
        "state:cart.setquantity" => {
            let Some(product_id) = product_id else {
                return Ok(false);
            };
            let Some(quantity) = non_negative_session_integer(field("quantity")) else {
                return Ok(false);
            };
            let items = nested_object_mut(root, "cart", "items");
            if quantity == 0 {
                return Ok(items.remove(&product_id).is_some());
            }
            let existing = items.get(&product_id).cloned();
            let mut item = serde_json::Map::from_iter([
                ("productId".into(), Value::String(product_id.clone())),
                ("quantity".into(), Value::from(quantity.min(1_000_000))),
            ]);
            copy_or_set_price(
                &mut item,
                existing.as_ref(),
                field("unitPriceMinor"),
                field("currency"),
            );
            items.insert(product_id, Value::Object(item));
            Ok(true)
        }
        "state:wishlist.toggle" => {
            let Some(product_id) = product_id else {
                return Ok(false);
            };
            let wishlist = root
                .entry("wishlist")
                .or_insert_with(|| Value::Array(Vec::new()));
            if !wishlist.is_array() {
                *wishlist = Value::Array(Vec::new());
            }
            let values = wishlist
                .as_array_mut()
                .expect("wishlist was normalized to an array");
            if let Some(index) = values
                .iter()
                .position(|value| value.as_str() == Some(&product_id))
            {
                values.remove(index);
            } else {
                values.push(Value::String(product_id));
                if values.len() > 2_000 {
                    values.drain(..values.len() - 2_000);
                }
            }
            Ok(true)
        }
        "state:value.set" => {
            let Some(key) = field("key").filter(|key| valid_value_key(key)) else {
                return Ok(false);
            };
            let value = parse_session_value(field("value").unwrap_or_default());
            let values = root
                .entry("values")
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
            if !values.is_object() {
                *values = Value::Object(serde_json::Map::new());
            }
            values
                .as_object_mut()
                .expect("values was normalized to an object")
                .insert(key.to_owned(), value);
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn mutate_site_session_patches(
    payload: &mut Value,
    request: &SiteSessionPatchRequest,
) -> Result<bool, StorageError> {
    let page_url = reqwest::Url::parse(&request.canonical_page_url)
        .map_err(|_| session_parameter_error("site session page URL is invalid"))?;
    if request.canonical_page_url.len() > 4_096
        || !matches!(page_url.scheme(), "http" | "https")
        || !page_url.username().is_empty()
        || page_url.password().is_some()
        || request.patches.len() > 16
        || request.patches.iter().any(|patch| {
            patch.revision < 0 || patch.html.len() > 64 * 1024 || !valid_region_id(&patch.region_id)
        })
    {
        return Err(session_parameter_error("site session patch exceeds limits"));
    }
    let root = payload
        .as_object_mut()
        .ok_or_else(|| session_parameter_error("site session payload must be an object"))?;
    let snapshots = root
        .entry("regionSnapshots")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !snapshots.is_object() {
        *snapshots = Value::Object(serde_json::Map::new());
    }
    let pages = snapshots
        .as_object_mut()
        .expect("snapshots was normalized to an object");
    let page = pages
        .entry(request.canonical_page_url.clone())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !page.is_object() {
        *page = Value::Object(serde_json::Map::new());
    }
    let regions = page
        .as_object_mut()
        .expect("page snapshots were normalized to an object");
    let updated_at = Utc::now().to_rfc3339();
    let mut changed = false;
    for patch in &request.patches {
        let existing = regions
            .get(&patch.region_id)
            .and_then(|snapshot| snapshot.get("revision"))
            .and_then(Value::as_i64);
        if existing.is_some_and(|revision| revision >= patch.revision) {
            continue;
        }
        regions.insert(
            patch.region_id.clone(),
            serde_json::json!({
                "html": patch.html,
                "revision": patch.revision,
                "updatedAt": updated_at,
            }),
        );
        changed = true;
    }
    if request.update_model_state {
        root.insert("modelState".into(), request.model_state.clone());
        changed = true;
    }
    Ok(changed)
}

fn nested_object_mut<'a>(
    root: &'a mut serde_json::Map<String, Value>,
    parent: &str,
    child: &str,
) -> &'a mut serde_json::Map<String, Value> {
    let parent_value = root
        .entry(parent)
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !parent_value.is_object() {
        *parent_value = Value::Object(serde_json::Map::new());
    }
    let parent_object = parent_value
        .as_object_mut()
        .expect("parent was normalized to an object");
    let child_value = parent_object
        .entry(child)
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !child_value.is_object() {
        *child_value = Value::Object(serde_json::Map::new());
    }
    child_value
        .as_object_mut()
        .expect("child was normalized to an object")
}

fn non_negative_session_integer(value: Option<&str>) -> Option<u64> {
    let value = value?;
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse::<u64>().ok()
}

fn positive_session_integer(value: Option<&str>) -> Option<u64> {
    non_negative_session_integer(value)
        .filter(|value| *value > 0)
        .map(|value| value.min(1_000_000))
}

fn normalized_currency(value: Option<&str>) -> Option<String> {
    let value = value?.to_ascii_uppercase();
    (value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())).then_some(value)
}

fn copy_or_set_price(
    item: &mut serde_json::Map<String, Value>,
    existing: Option<&Value>,
    requested_price: Option<&str>,
    requested_currency: Option<&str>,
) {
    let requested = non_negative_session_integer(requested_price)
        .filter(|value| *value <= i64::MAX as u64)
        .zip(normalized_currency(requested_currency));
    let existing = existing.and_then(Value::as_object).and_then(|existing| {
        existing.get("unitPriceMinor").and_then(Value::as_u64).zip(
            existing
                .get("currency")
                .and_then(Value::as_str)
                .and_then(|value| normalized_currency(Some(value))),
        )
    });
    if let Some((price, currency)) = requested.or(existing) {
        item.insert("unitPriceMinor".into(), Value::from(price));
        item.insert("currency".into(), Value::String(currency));
    }
}

fn valid_value_key(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && value.len() <= 64
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

fn valid_region_id(value: &str) -> bool {
    valid_value_key(value)
}

fn parse_session_value(value: &str) -> Value {
    match value {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        "null" => Value::Null,
        _ if valid_json_number(value) => serde_json::from_str(value)
            .unwrap_or_else(|_| Value::String(value.chars().take(16_384).collect())),
        _ => Value::String(value.chars().take(16_384).collect()),
    }
}

fn valid_json_number(value: &str) -> bool {
    if value.is_empty() || value.contains(['e', 'E', '+']) {
        return false;
    }
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let mut parts = unsigned.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    parts.next().is_none()
        && (!integer.is_empty() && integer.bytes().all(|byte| byte.is_ascii_digit()))
        && (integer == "0" || !integer.starts_with('0'))
        && fraction.is_none_or(|fraction| {
            !fraction.is_empty() && fraction.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn fit_site_session(payload: &mut Value) -> Result<(), StorageError> {
    let size = |value: &Value| serde_json::to_vec(value).map(|bytes| bytes.len());
    if size(payload)? <= MAX_SITE_SESSION_BYTES {
        return Ok(());
    }
    let mut snapshots = payload
        .get("regionSnapshots")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|pages| pages.iter())
        .flat_map(|(url, regions)| {
            regions.as_object().into_iter().flat_map(move |regions| {
                regions.iter().map(move |(id, snapshot)| {
                    (
                        snapshot
                            .get("updatedAt")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        url.clone(),
                        id.clone(),
                    )
                })
            })
        })
        .collect::<Vec<_>>();
    snapshots.sort();
    for (_, url, region_id) in snapshots {
        if let Some(pages) = payload
            .get_mut("regionSnapshots")
            .and_then(Value::as_object_mut)
        {
            if let Some(regions) = pages.get_mut(&url).and_then(Value::as_object_mut) {
                regions.remove(&region_id);
                if regions.is_empty() {
                    pages.remove(&url);
                }
            }
        }
        if size(payload)? <= MAX_SITE_SESSION_BYTES {
            return Ok(());
        }
    }
    if let Some(root) = payload.as_object_mut() {
        root.remove("modelState");
    }
    if size(payload)? <= MAX_SITE_SESSION_BYTES {
        return Ok(());
    }
    loop {
        let removed = payload
            .get_mut("wishlist")
            .and_then(Value::as_array_mut)
            .is_some_and(|wishlist| {
                !wishlist.is_empty() && {
                    wishlist.remove(0);
                    true
                }
            });
        if !removed || size(payload)? <= MAX_SITE_SESSION_BYTES {
            break;
        }
    }
    if size(payload)? <= MAX_SITE_SESSION_BYTES {
        return Ok(());
    }
    for container in [("cart", Some("items")), ("values", None)] {
        let keys = match container {
            (parent, Some(child)) => payload
                .get(parent)
                .and_then(Value::as_object)
                .and_then(|value| value.get(child))
                .and_then(Value::as_object),
            (parent, None) => payload.get(parent).and_then(Value::as_object),
        }
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
        for key in keys {
            match container {
                (parent, Some(child)) => {
                    payload
                        .get_mut(parent)
                        .and_then(Value::as_object_mut)
                        .and_then(|value| value.get_mut(child))
                        .and_then(Value::as_object_mut)
                        .map(|object| object.remove(&key));
                }
                (parent, None) => {
                    payload
                        .get_mut(parent)
                        .and_then(Value::as_object_mut)
                        .map(|object| object.remove(&key));
                }
            }
            if size(payload)? <= MAX_SITE_SESSION_BYTES {
                return Ok(());
            }
        }
    }
    Err(StorageError::SiteSessionTooLarge)
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

fn migration_applied(connection: &Connection, version: i64) -> Result<bool, StorageError> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=?1)",
        [version],
        |row| row.get(0),
    )?)
}

fn table_has_column(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, StorageError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for candidate in columns {
        if candidate? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn apply_performance_migrations(connection: &Connection) -> Result<bool, StorageError> {
    if !migration_applied(connection, 3)? {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS browsing_history (
              id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL,
              url TEXT NOT NULL,
              title TEXT NOT NULL,
              status TEXT NOT NULL,
              opened_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              favicon TEXT,
              artifact_id TEXT,
              generation_job_id TEXT,
              error_message TEXT
            );
            CREATE INDEX IF NOT EXISTS browsing_history_profile_opened
              ON browsing_history(profile_id, opened_at DESC, id DESC);
            INSERT INTO schema_migrations(version, applied_at) VALUES (3, CURRENT_TIMESTAMP);
            COMMIT;
            "#,
        )?;
    }

    if !migration_applied(connection, 4)? {
        if !table_has_column(connection, "cached_assets", "source_url")? {
            connection.execute("ALTER TABLE cached_assets ADD COLUMN source_url TEXT", [])?;
        }
        if !table_has_column(connection, "cached_assets", "state")? {
            connection.execute(
                "ALTER TABLE cached_assets ADD COLUMN state TEXT NOT NULL DEFAULT 'ready'",
                [],
            )?;
        }
        if !table_has_column(connection, "cached_assets", "retry_at")? {
            connection.execute("ALTER TABLE cached_assets ADD COLUMN retry_at TEXT", [])?;
        }
        if !table_has_column(connection, "cached_assets", "error_count")? {
            connection.execute(
                "ALTER TABLE cached_assets ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        connection.execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS cached_assets_profile_accessed
              ON cached_assets(profile_id, last_accessed_at ASC);
            INSERT INTO schema_migrations(version, applied_at) VALUES (4, CURRENT_TIMESTAMP);
            "#,
        )?;
    }

    if migration_applied(connection, 5)? {
        return Ok(false);
    }

    let artifacts = {
        let mut statement =
            connection.prepare("SELECT id, profile_id, created_at, payload FROM artifacts")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let jobs = {
        let mut statement =
            connection.prepare("SELECT id, request_payload FROM generation_jobs")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let stages = {
        let mut statement = connection.prepare(
            "SELECT job_id, profile_id, stage, status, started_at, completed_at, payload
             FROM generation_stage_records",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let transaction = connection.unchecked_transaction()?;
    for (artifact_id, profile_id, created_at, payload) in artifacts {
        let artifact_payload: Value = serde_json::from_str(&payload)?;
        let artifact = ArtifactRecord {
            id: artifact_id.clone(),
            profile_id: profile_id.clone(),
            site_id: String::new(),
            url: String::new(),
            title: String::new(),
            html: String::new(),
            created_at,
            payload: artifact_payload,
        };
        let (lean_payload, exchanges) = persisted_artifact_payload(&artifact)?;
        transaction.execute(
            "UPDATE artifacts SET payload=?2 WHERE id=?1",
            params![artifact_id, lean_payload],
        )?;
        for exchange in exchanges {
            upsert_generation_stage_on(
                &transaction,
                GenerationStageWrite {
                    job_id: &exchange.job_id,
                    profile_id: &profile_id,
                    stage: &exchange.stage,
                    status: "completed",
                    started_at: &exchange.started_at,
                    completed_at: exchange.completed_at.as_deref(),
                    payload: &exchange.payload,
                },
            )?;
        }
    }
    for (job_id, payload) in jobs {
        let payload: Value = serde_json::from_str(&payload)?;
        transaction.execute(
            "UPDATE generation_jobs SET request_payload=?2 WHERE id=?1",
            params![
                job_id,
                serde_json::to_string(&generation_request_summary(&payload))?
            ],
        )?;
    }
    for (job_id, profile_id, stage, status, started_at, completed_at, payload) in stages {
        let payload: Value = serde_json::from_str(&payload)?;
        upsert_generation_stage_on(
            &transaction,
            GenerationStageWrite {
                job_id: &job_id,
                profile_id: &profile_id,
                stage: &stage,
                status: &status,
                started_at: &started_at,
                completed_at: completed_at.as_deref(),
                payload: &payload,
            },
        )?;
    }
    transaction.execute(
        "DELETE FROM generation_job_events
         WHERE event_type IN ('generation.progress', 'generation.metadata', 'generation.preview', 'generation.stage')",
        [],
    )?;
    let terminal_events = {
        let mut statement = transaction.prepare(
            "SELECT id, event_type, payload FROM generation_job_events
             WHERE event_type IN ('generation.completed', 'dynamic.completed')",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (id, event_type, payload) in terminal_events {
        let payload: Value = serde_json::from_str(&payload)?;
        transaction.execute(
            "UPDATE generation_job_events SET payload=?2 WHERE id=?1",
            params![
                id,
                serde_json::to_string(&compact_event_payload(&event_type, &payload))?
            ],
        )?;
    }
    transaction.execute(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (5, CURRENT_TIMESTAMP)",
        [],
    )?;
    transaction.commit()?;
    Ok(true)
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
CREATE INDEX IF NOT EXISTS generation_jobs_profile_created
  ON generation_jobs(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS generation_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  sequence INTEGER,
  timestamp TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS generation_events_profile_job
  ON generation_job_events(profile_id, job_id, id);

CREATE TABLE IF NOT EXISTS generation_stage_records (
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY(job_id, stage)
);
CREATE INDEX IF NOT EXISTS generation_stages_profile_job
  ON generation_stage_records(profile_id, job_id, started_at);

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

CREATE TABLE IF NOT EXISTS media_connections (
  id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  last_verified_at TEXT,
  voices TEXT NOT NULL,
  PRIMARY KEY(profile_id, id)
);
CREATE INDEX IF NOT EXISTS media_connections_profile ON media_connections(profile_id);

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
    use serde_json::{json, Value};

    use super::{ArtifactRecord, GenerationStageWrite, SiteWorldRecord, Storage, StorageHandle};
    use crate::protocol::{
        BrowsingHistoryRecord, MediaConnectionRecord, MediaVoiceRecord, SiteRegionPatch,
        SiteSessionActionRequest, SiteSessionPatchRequest, SiteSessionRecord,
    };
    use std::collections::BTreeMap;

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
    fn artifacts_move_model_exchanges_to_canonical_stages_and_drop_noisy_events() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        storage
            .mark_job_started(
                "job-compact",
                "personal",
                &json!({
                    "url": "https://example.com/", "prompt": "large prompt that must not persist",
                    "provider": { "kind": "openai-compatible", "modelId": "evo" }
                }),
            )
            .unwrap();
        let artifact = ArtifactRecord {
            id: "artifact-compact".into(),
            profile_id: "personal".into(),
            site_id: "site-1".into(),
            url: "https://example.com/".into(),
            title: "Example".into(),
            html: "<title>Example</title>".into(),
            created_at: "2026-08-23T00:00:00Z".into(),
            payload: json!({
                "generationId": "job-compact",
                "modelExchanges": [{
                    "purpose": "page-builder", "startedAt": "2026-08-23T00:00:00Z",
                    "completedAt": "2026-08-23T00:00:01Z", "prompt": "brief", "response": "<html>"
                }]
            }),
        };
        storage.save_artifact(&artifact).unwrap();
        storage
            .record_job_event(
                "job-compact",
                "personal",
                "generation.preview",
                Some(1),
                "2026-08-23T00:00:00Z",
                &json!({"html":"large"}),
            )
            .unwrap();
        storage.record_job_event("job-compact", "personal", "generation.completed", Some(2), "2026-08-23T00:00:01Z", &json!({
            "jobId": "job-compact", "artifact": { "id": "artifact-compact", "html": "must not duplicate" },
            "usage": { "requests": 1 }
        })).unwrap();

        let restored = storage
            .artifact("artifact-compact", "personal")
            .unwrap()
            .unwrap();
        assert!(restored.payload.get("modelExchanges").is_none());
        let detail = storage
            .generation_activity("personal", "job-compact")
            .unwrap()
            .unwrap();
        assert_eq!(detail.stages.len(), 1);
        assert_eq!(detail.stages[0].stage, "page-builder");
        assert_eq!(detail.events.len(), 1);
        assert_eq!(detail.events[0].payload["artifactId"], "artifact-compact");
        assert!(detail.events[0].payload.pointer("/artifact/html").is_none());
        assert!(detail.job.request_payload.get("prompt").is_none());
    }

    #[test]
    fn browsing_history_uses_stable_profile_scoped_cursors() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        let records = (1..=3)
            .map(|index| BrowsingHistoryRecord {
                id: format!("entry-{index}"),
                profile_id: "personal".into(),
                url: format!("https://example.com/{index}"),
                title: format!("Entry {index}"),
                status: "completed".into(),
                opened_at: format!("2026-08-23T00:00:0{index}Z"),
                updated_at: format!("2026-08-23T00:00:0{index}Z"),
                favicon: None,
                artifact_id: None,
                generation_job_id: None,
                error_message: None,
            })
            .collect::<Vec<_>>();
        assert_eq!(storage.upsert_browsing_history(&records).unwrap(), 3);
        let first = storage.browsing_history("personal", 2, None).unwrap();
        assert_eq!(
            first
                .items
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            ["entry-3", "entry-2"]
        );
        let second = storage
            .browsing_history("personal", 2, first.next_cursor.as_deref())
            .unwrap();
        assert_eq!(
            second
                .items
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            ["entry-1"]
        );
        assert!(storage
            .browsing_history("work", 100, None)
            .unwrap()
            .items
            .is_empty());
    }

    #[tokio::test]
    async fn storage_handle_executes_database_work_on_its_actor() {
        let path = std::env::temp_dir().join(format!(
            "vibesurfer-storage-actor-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let storage = StorageHandle::open(&path).unwrap();
        let result = storage
            .run(|database| {
                database.mark_job_started(
                    "actor-job",
                    "personal",
                    &json!({"url":"https://example.com"}),
                )?;
                Ok(database
                    .generation_job_page("personal", 10, None)?
                    .items
                    .len())
            })
            .await
            .unwrap();
        assert_eq!(result, 1);
        drop(storage);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn media_connections_are_profile_scoped_and_deleted_with_profile_data() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        for profile_id in ["personal", "work"] {
            storage
                .upsert_media_connection(&MediaConnectionRecord {
                    id: "elevenlabs".into(),
                    profile_id: profile_id.into(),
                    provider: "elevenlabs".into(),
                    display_name: "ElevenLabs media".into(),
                    secret_ref: format!("{profile_id}:elevenlabs"),
                    status: "valid".into(),
                    last_verified_at: Some("2026-08-22T00:00:00Z".into()),
                    voices: vec![MediaVoiceRecord {
                        id: "voice-one".into(),
                        name: "One".into(),
                        category: Some("premade".into()),
                    }],
                })
                .unwrap();
        }
        assert_eq!(storage.list_media_connections("personal").unwrap().len(), 1);
        assert_eq!(storage.list_media_connections("work").unwrap().len(), 1);
        storage.delete_profile_data("personal").unwrap();
        assert!(storage
            .list_media_connections("personal")
            .unwrap()
            .is_empty());
        assert_eq!(storage.list_media_connections("work").unwrap().len(), 1);
    }

    #[test]
    fn generation_activity_is_profile_scoped_paged_and_hashes_truncation() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        let request = json!({"url":"https://example.com/report","provider":{"modelId":"gpt-test"}});
        storage
            .mark_job_started("job-1", "personal", &request)
            .unwrap();
        storage
            .mark_job_started("job-other", "work", &request)
            .unwrap();
        storage
            .record_job_event(
                "job-1",
                "personal",
                "generation.started",
                Some(1),
                "2026-08-12T00:00:00Z",
                &json!({"type":"generation.started"}),
            )
            .unwrap();
        let large_prompt = "x".repeat(300 * 1024);
        storage
            .upsert_generation_stage(GenerationStageWrite {
                job_id: "job-1",
                profile_id: "personal",
                stage: "page-director",
                status: "running",
                started_at: "2026-08-12T00:00:00Z",
                completed_at: None,
                payload: &json!({"prompt":large_prompt,"response":"{}"}),
            })
            .unwrap();

        let jobs = storage.generation_job_page("personal", 50, None).unwrap();
        assert_eq!(jobs.items.len(), 1);
        assert_eq!(jobs.items[0].id, "job-1");
        let detail = storage
            .generation_activity("personal", "job-1")
            .unwrap()
            .unwrap();
        assert_eq!(detail.events.len(), 1);
        assert_eq!(detail.stages.len(), 1);
        assert_eq!(detail.stages[0].payload["prompt"]["truncated"], true);
        assert_eq!(
            detail.stages[0].payload["prompt"]["sha256"]
                .as_str()
                .unwrap()
                .len(),
            64
        );
        assert!(storage
            .generation_activity("work", "job-1")
            .unwrap()
            .is_none());
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
        assert_eq!(
            storage
                .site_session("personal", "site-1")
                .unwrap()
                .unwrap()
                .revision,
            2
        );
        let stale = SiteSessionRecord {
            revision: 1,
            payload: json!({"stale":true}),
            ..initial
        };
        assert!(!storage.upsert_site_session(&stale).unwrap());
        assert_eq!(
            storage
                .site_session("personal", "site-1")
                .unwrap()
                .unwrap()
                .revision,
            2
        );
    }

    #[test]
    fn site_session_actions_and_patches_are_atomic_and_revisioned() {
        let storage = Storage::open(std::path::Path::new(":memory:")).unwrap();
        let fields = |quantity: &str| {
            BTreeMap::from([
                ("productId".into(), vec!["sku-1".into()]),
                ("quantity".into(), vec![quantity.into()]),
                ("unitPriceMinor".into(), vec!["1250".into()]),
                ("currency".into(), vec!["usd".into()]),
            ])
        };
        let first = storage
            .apply_site_session_action(&SiteSessionActionRequest {
                profile_id: "personal".into(),
                site_world_id: "site-1".into(),
                action: "state:cart.add".into(),
                fields: fields("2"),
            })
            .unwrap();
        let second = storage
            .apply_site_session_action(&SiteSessionActionRequest {
                profile_id: "personal".into(),
                site_world_id: "site-1".into(),
                action: "state:cart.add".into(),
                fields: fields("3"),
            })
            .unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(second.revision, 2);
        assert_eq!(second.payload["cart"]["items"]["sku-1"]["quantity"], 5);
        assert_eq!(second.payload["cart"]["items"]["sku-1"]["currency"], "USD");

        let patched = storage
            .apply_site_session_patches(&SiteSessionPatchRequest {
                profile_id: "personal".into(),
                site_world_id: "site-1".into(),
                canonical_page_url: "https://example.com/live".into(),
                patches: vec![SiteRegionPatch {
                    region_id: "feed".into(),
                    html: "<p>fresh</p>".into(),
                    revision: 1,
                }],
                update_model_state: false,
                model_state: Value::Null,
            })
            .unwrap();
        assert_eq!(patched.revision, 3);
        let stale = storage
            .apply_site_session_patches(&SiteSessionPatchRequest {
                profile_id: "personal".into(),
                site_world_id: "site-1".into(),
                canonical_page_url: "https://example.com/live".into(),
                patches: vec![SiteRegionPatch {
                    region_id: "feed".into(),
                    html: "<p>stale</p>".into(),
                    revision: 1,
                }],
                update_model_state: false,
                model_state: Value::Null,
            })
            .unwrap();
        assert_eq!(stale.revision, 3);
        assert_eq!(
            stale.payload["regionSnapshots"]["https://example.com/live"]["feed"]["html"],
            "<p>fresh</p>"
        );
        assert!(storage.site_session("work", "site-1").unwrap().is_none());
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
        assert_eq!(
            storage.delete_site_world(&initial.id, "personal").unwrap(),
            1
        );
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
        let migrated = storage
            .site_world("legacy-site", "personal")
            .unwrap()
            .unwrap();
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
            storage
                .site_world("legacy-site", "personal")
                .unwrap()
                .unwrap()
                .state,
            "archived"
        );
        drop(storage);
        std::fs::remove_file(path).unwrap();
    }
}
