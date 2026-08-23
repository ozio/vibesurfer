use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{ipc::Channel, AppHandle, Manager};
use thiserror::Error;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, Mutex, OwnedSemaphorePermit, Semaphore},
    time::{sleep_until, Instant},
};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    protocol::{ArtifactRecord, GenerationStartRequest, WORKER_PROTOCOL_VERSION},
    storage::{GenerationStageWrite, StorageHandle},
};

const CANCEL_GRACE: Duration = Duration::from_secs(5);
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(10);
const GENERATION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const RESET_TIMEOUT: Duration = Duration::from_secs(3);
const WORKER_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_BUSY_WORKERS: usize = 4;
const MAX_IDLE_WORKERS: usize = 2;
// A completed artifact can include the rendered HTML plus up to four persisted
// model request/response transcripts for the generation inspector.
const MAX_WORKER_LINE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("generation worker is unavailable: {0}")]
    Unavailable(String),
    #[error("could not start generation worker: {0}")]
    Spawn(String),
    #[error("worker I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("worker protocol failed: {0}")]
    Protocol(String),
    #[error("worker request serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("job already exists")]
    DuplicateJob,
    #[error("job was not found")]
    JobNotFound,
}

#[derive(Clone)]
pub struct WorkerManager {
    jobs: Arc<Mutex<HashMap<String, mpsc::Sender<WorkerControl>>>>,
    idle: Arc<Mutex<Vec<IdleWorker>>>,
    capacity: Arc<Semaphore>,
    spawned_workers: Arc<AtomicU64>,
    reused_workers: Arc<AtomicU64>,
}

#[derive(Debug)]
enum WorkerControl {
    Cancel,
}

#[derive(Clone, Debug)]
pub struct WorkerCommand {
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub description: String,
}

struct PooledWorker {
    key: String,
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}

struct IdleWorker {
    worker: PooledWorker,
    idle_since: Instant,
}

impl WorkerManager {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            idle: Arc::new(Mutex::new(Vec::new())),
            capacity: Arc::new(Semaphore::new(MAX_BUSY_WORKERS)),
            spawned_workers: Arc::new(AtomicU64::new(0)),
            reused_workers: Arc::new(AtomicU64::new(0)),
        }
    }

    pub async fn active_job_count(&self) -> usize {
        self.jobs.lock().await.len()
    }

    pub async fn idle_worker_count(&self) -> usize {
        self.idle.lock().await.len()
    }

    pub fn spawned_worker_count(&self) -> u64 {
        self.spawned_workers.load(Ordering::Relaxed)
    }

    pub fn reused_worker_count(&self) -> u64 {
        self.reused_workers.load(Ordering::Relaxed)
    }

    async fn acquire_capacity(&self) -> Result<OwnedSemaphorePermit, WorkerError> {
        self.capacity
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| WorkerError::Unavailable("worker pool is shutting down".into()))
    }

    async fn checkout(
        &self,
        app: &AppHandle,
        codex_program: Option<&Path>,
    ) -> Result<PooledWorker, WorkerError> {
        let command = Self::discover(app)?;
        let key = worker_key(&command, codex_program);
        let now = Instant::now();
        let (candidate, stale) = {
            let mut idle = self.idle.lock().await;
            let mut retained = Vec::with_capacity(idle.len());
            let mut candidate = None;
            let mut stale = Vec::new();
            for entry in idle.drain(..) {
                if now.duration_since(entry.idle_since) >= WORKER_IDLE_TIMEOUT {
                    stale.push(entry.worker);
                } else if candidate.is_none() && entry.worker.key == key {
                    candidate = Some(entry.worker);
                } else {
                    retained.push(entry);
                }
            }
            *idle = retained;
            (candidate, stale)
        };
        for mut worker in stale {
            let _ = worker.child.kill().await;
        }
        if let Some(mut worker) = candidate {
            if worker.child.try_wait()?.is_none() {
                self.reused_workers.fetch_add(1, Ordering::Relaxed);
                return Ok(worker);
            }
        }
        let worker = spawn_initialized_worker(&command, codex_program).await?;
        self.spawned_workers.fetch_add(1, Ordering::Relaxed);
        Ok(worker)
    }

    async fn recycle(&self, mut worker: PooledWorker) {
        let mut idle = self.idle.lock().await;
        if idle.len() < MAX_IDLE_WORKERS {
            idle.push(IdleWorker {
                worker,
                idle_since: Instant::now(),
            });
            return;
        }
        drop(idle);
        let _ = worker.child.kill().await;
    }

    pub fn discover(app: &AppHandle) -> Result<WorkerCommand, WorkerError> {
        let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| WorkerError::Unavailable("project root cannot be resolved".into()))?;
        let executable_dir = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf));
        let resource_dir = app.path().resource_dir().ok();
        discover_worker_command(
            std::env::var_os("VIBESURFER_GENERATION_WORKER").map(PathBuf::from),
            executable_dir,
            resource_dir,
            project_root,
            Path::is_file,
            || command_available("bun"),
        )
    }

    pub async fn start_generation(
        &self,
        app: AppHandle,
        storage: StorageHandle,
        input: GenerationStartRequest,
        credential: Option<Zeroizing<String>>,
        codex_program: Option<PathBuf>,
        channel: Channel<Value>,
    ) -> Result<String, WorkerError> {
        let job_id = input
            .job_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let (control_tx, control_rx) = mpsc::channel(2);
        {
            let mut jobs = self.jobs.lock().await;
            if jobs.contains_key(&job_id) {
                return Err(WorkerError::DuplicateJob);
            }
            jobs.insert(job_id.clone(), control_tx);
        }

        let manager = self.clone();
        let task_job_id = job_id.clone();
        let is_dynamic =
            input.request.get("kind").and_then(Value::as_str) == Some("dynamic-region");
        tauri::async_runtime::spawn(async move {
            let outcome = run_generation(
                &manager,
                &app,
                storage.clone(),
                &task_job_id,
                &input.profile_id,
                &input.request,
                credential.as_ref().map(|value| value.as_str()),
                codex_program.as_deref(),
                channel.clone(),
                control_rx,
            )
            .await;

            if let Err(error) = outcome {
                let payload = json!({
                    "type": if is_dynamic { "dynamic.failed" } else { "generation.failed" },
                    "jobId": task_job_id,
                    "error": {
                        "code": "worker-crashed",
                        "message": error.to_string(),
                        "retryable": true
                    }
                });
                let failed_job_id = payload["jobId"].as_str().unwrap_or_default().to_owned();
                let error_payload = payload.get("error").cloned();
                let _ = storage
                    .run(move |database| {
                        database.update_job(&failed_job_id, "failed", None, error_payload.as_ref())
                    })
                    .await;
                let _ = channel.send(payload);
            }
            manager.jobs.lock().await.remove(&task_job_id);
        });

        Ok(job_id)
    }

    pub async fn cancel(&self, job_id: &str) -> Result<(), WorkerError> {
        let sender = self
            .jobs
            .lock()
            .await
            .get(job_id)
            .cloned()
            .ok_or(WorkerError::JobNotFound)?;
        sender
            .send(WorkerControl::Cancel)
            .await
            .map_err(|_| WorkerError::JobNotFound)
    }

    pub async fn verify_provider(
        &self,
        app: &AppHandle,
        provider: &Value,
        credential: &str,
    ) -> Result<Value, WorkerError> {
        let _permit = self.acquire_capacity().await?;
        let mut worker = self.checkout(app, None).await?;

        let request_id = Uuid::new_v4().to_string();
        let request = ProviderVerifyMessage {
            message_type: "provider.verify",
            request_id: &request_id,
            provider,
            credential,
        };
        send_message(&mut worker.stdin, &request).await?;

        let result = match tokio::time::timeout(Duration::from_secs(95), async {
            while let Some(line) = worker.lines.next_line().await? {
                if line.len() > MAX_WORKER_LINE_BYTES {
                    return Err(WorkerError::Protocol("worker line exceeds limit".into()));
                }
                let mut event: Value = serde_json::from_str(&line)?;
                redact_sensitive_fields(&mut event);
                if event.get("requestId").and_then(Value::as_str) != Some(&request_id) {
                    continue;
                }
                match event.get("type").and_then(Value::as_str) {
                    Some("provider.verified") => return Ok(event),
                    Some("provider.failed") => {
                        return Err(WorkerError::Protocol(
                            event
                                .pointer("/error/message")
                                .and_then(Value::as_str)
                                .unwrap_or("provider verification failed")
                                .to_owned(),
                        ));
                    }
                    _ => {}
                }
            }
            Err(WorkerError::Protocol(
                "worker exited before provider verification completed".into(),
            ))
        })
        .await
        {
            Ok(result) => result,
            Err(_) => Err(WorkerError::Protocol(
                "provider verification timed out".into(),
            )),
        };
        if reset_worker(&mut worker).await.is_ok() {
            self.recycle(worker).await;
        } else {
            let _ = worker.child.kill().await;
        }
        result
    }
}

fn discover_worker_command(
    explicit_worker: Option<PathBuf>,
    executable_dir: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
    project_root: &Path,
    is_file: impl Fn(&Path) -> bool,
    bun_available: impl Fn() -> bool,
) -> Result<WorkerCommand, WorkerError> {
    if let Some(path) = explicit_worker.filter(|path| is_file(path)) {
        return Ok(WorkerCommand {
            description: path.display().to_string(),
            program: path,
            arguments: Vec::new(),
        });
    }

    for directory in [executable_dir, resource_dir].into_iter().flatten() {
        for name in packaged_worker_names() {
            let candidate = directory.join(name);
            if is_file(&candidate) {
                return Ok(WorkerCommand {
                    description: candidate.display().to_string(),
                    program: candidate,
                    arguments: Vec::new(),
                });
            }
        }
    }

    let compiled_script = project_root.join("generation-worker/dist/index.js");
    if is_file(&compiled_script) {
        return Ok(WorkerCommand {
            program: PathBuf::from("node"),
            arguments: vec![compiled_script.display().to_string()],
            description: format!("node {}", compiled_script.display()),
        });
    }

    let source_script = project_root.join("generation-worker/src/index.ts");
    if is_file(&source_script) && bun_available() {
        return Ok(WorkerCommand {
            program: PathBuf::from("bun"),
            arguments: vec!["run".into(), source_script.display().to_string()],
            description: format!("bun run {}", source_script.display()),
        });
    }

    Err(WorkerError::Unavailable(
        "build generation-worker or set VIBESURFER_GENERATION_WORKER".into(),
    ))
}

#[allow(clippy::too_many_arguments)]
async fn run_generation(
    manager: &WorkerManager,
    app: &AppHandle,
    storage: StorageHandle,
    job_id: &str,
    profile_id: &str,
    request: &Value,
    credential: Option<&str>,
    codex_program: Option<&Path>,
    channel: Channel<Value>,
    mut control_rx: mpsc::Receiver<WorkerControl>,
) -> Result<(), WorkerError> {
    let is_discovery =
        request.pointer("/discovery/kind").and_then(Value::as_str) == Some("lucky-urls");
    let is_dynamic = request.get("kind").and_then(Value::as_str) == Some("dynamic-region");
    let stored_job_id = job_id.to_owned();
    let stored_profile_id = profile_id.to_owned();
    let stored_request = request.clone();
    storage
        .run(move |database| {
            database.mark_job_started(&stored_job_id, &stored_profile_id, &stored_request)
        })
        .await
        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
    let _permit = manager.acquire_capacity().await?;
    let mut worker = manager.checkout(app, codex_program).await?;
    let request_id = Uuid::new_v4().to_string();
    let generate = GenerateMessage {
        message_type: "generate",
        request_id: &request_id,
        job_id,
        request,
        credential,
    };
    send_message(&mut worker.stdin, &generate).await?;

    let mut terminal_event_seen = false;
    let mut cancel_deadline: Option<Instant> = None;
    let generation_deadline = Instant::now() + GENERATION_TIMEOUT;
    let mut last_sequence = 0_u64;

    loop {
        tokio::select! {
            control = control_rx.recv() => {
                if matches!(control, Some(WorkerControl::Cancel)) {
                    let cancel = CancelMessage {
                        message_type: "cancel",
                        request_id: Uuid::new_v4().to_string(),
                        job_id,
                    };
                    send_message(&mut worker.stdin, &cancel).await?;
                    cancel_deadline = Some(Instant::now() + CANCEL_GRACE);
                }
            }
            line = worker.lines.next_line() => {
                let Some(line) = line? else { break; };
                if line.len() > MAX_WORKER_LINE_BYTES {
                    return Err(WorkerError::Protocol("worker line exceeds limit".into()));
                }
                let mut event: Value = serde_json::from_str(&line)?;
                redact_sensitive_fields(&mut event);
                let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();
                if event.get("jobId").and_then(Value::as_str) != Some(job_id) {
                    continue;
                }
                validate_event_sequence(event_type, &event, &mut last_sequence)?;

                if event_type != "generation.preview" {
                    let timestamp = event.get("at").and_then(Value::as_str)
                        .unwrap_or_else(|| event.get("timestamp").and_then(Value::as_str).unwrap_or(""));
                    let stored_job_id = job_id.to_owned();
                    let stored_profile_id = profile_id.to_owned();
                    let stored_event_type = event_type.to_owned();
                    let stored_timestamp = timestamp.to_owned();
                    let sequence = event.get("sequence").and_then(Value::as_i64);
                    let stored_event = event.clone();
                    storage.run(move |database| database.record_job_event(
                        &stored_job_id,
                        &stored_profile_id,
                        &stored_event_type,
                        sequence,
                        &stored_timestamp,
                        &stored_event,
                    )).await.map_err(|error| WorkerError::Protocol(error.to_string()))?;
                }

                if event_type == "generation.completed" {
                    let mut artifact_value = event
                        .get("artifact")
                        .cloned()
                        .ok_or_else(|| WorkerError::Protocol("completed event has no artifact".into()))?;
                    ensure_artifact_host_fields(&mut artifact_value, profile_id, job_id);
                    let artifact: ArtifactRecord = serde_json::from_value(artifact_value.clone())?;
                    if is_discovery {
                        persist_model_exchanges(&storage, job_id, profile_id, &artifact).await?;
                    }
                    event["artifact"] = artifact_value;
                    if !is_discovery {
                        storage.run(move |database| database.save_artifact(&artifact))
                            .await
                            .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    }
                    let stored_job_id = job_id.to_owned();
                    let artifact_id = (!is_discovery).then(|| event.pointer("/artifact/id").and_then(Value::as_str).unwrap_or_default().to_owned());
                    storage.run(move |database| database.update_job(&stored_job_id, "completed", artifact_id.as_deref(), None))
                        .await
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    terminal_event_seen = true;
                } else if event_type == "dynamic.completed" && is_dynamic {
                    let stored_job_id = job_id.to_owned();
                    storage.run(move |database| database.update_job(&stored_job_id, "completed", None, None))
                        .await
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    terminal_event_seen = true;
                } else if event_type == "generation.failed" || (event_type == "dynamic.failed" && is_dynamic) {
                    let stored_job_id = job_id.to_owned();
                    let error_payload = event.get("error").cloned();
                    storage.run(move |database| database.update_job(&stored_job_id, "failed", None, error_payload.as_ref()))
                        .await
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    terminal_event_seen = true;
                } else if event_type == "generation.cancelled" || (event_type == "dynamic.cancelled" && is_dynamic) {
                    let stored_job_id = job_id.to_owned();
                    storage.run(move |database| database.update_job(&stored_job_id, "cancelled", None, None))
                        .await
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    terminal_event_seen = true;
                } else if event_type == "generation.phase" {
                    if let Some(phase) = event.get("phase").and_then(Value::as_str) {
                        let stored_job_id = job_id.to_owned();
                        let stored_phase = phase.to_owned();
                        let _ = storage.run(move |database| database.update_job(&stored_job_id, &stored_phase, None, None)).await;
                    }
                } else if event_type == "generation.stage" {
                    let stage = event.get("stage").and_then(Value::as_str).unwrap_or("unknown");
                    let status = event.get("status").and_then(Value::as_str).unwrap_or("running");
                    let started_at = event.get("startedAt").and_then(Value::as_str)
                        .or_else(|| event.get("at").and_then(Value::as_str))
                        .unwrap_or("");
                    let stored_job_id = job_id.to_owned();
                    let stored_profile_id = profile_id.to_owned();
                    let stored_stage = stage.to_owned();
                    let stored_status = status.to_owned();
                    let stored_started_at = started_at.to_owned();
                    let stored_completed_at = event.get("completedAt").and_then(Value::as_str).map(str::to_owned);
                    let stored_payload = event.get("payload").cloned().unwrap_or(Value::Null);
                    storage.run(move |database| database.upsert_generation_stage(GenerationStageWrite {
                        job_id: &stored_job_id,
                        profile_id: &stored_profile_id,
                        stage: &stored_stage,
                        status: &stored_status,
                        started_at: &stored_started_at,
                        completed_at: stored_completed_at.as_deref(),
                        payload: &stored_payload,
                    })).await.map_err(|error| WorkerError::Protocol(error.to_string()))?;
                }

                let _ = channel.send(event);
                if terminal_event_seen { break; }
            }
            _ = wait_for_deadline(cancel_deadline), if cancel_deadline.is_some() => {
                let _ = worker.child.kill().await;
                let event = json!({
                    "type": if is_dynamic { "dynamic.cancelled" } else { "generation.cancelled" },
                    "jobId": job_id,
                    "sequence": last_sequence + 1,
                    "at": Utc::now().to_rfc3339()
                });
                let stored_job_id = job_id.to_owned();
                let stored_profile_id = profile_id.to_owned();
                let stored_event_type = event["type"].as_str().unwrap_or("generation.cancelled").to_owned();
                let stored_sequence = event["sequence"].as_i64();
                let stored_timestamp = event["at"].as_str().unwrap_or("").to_owned();
                let stored_event = event.clone();
                let _ = storage.run(move |database| {
                    database.update_job(&stored_job_id, "cancelled", None, None)?;
                    database.record_job_event(
                        &stored_job_id, &stored_profile_id, &stored_event_type,
                        stored_sequence, &stored_timestamp, &stored_event,
                    )
                }).await;
                let _ = channel.send(event);
                terminal_event_seen = true;
                break;
            }
            _ = sleep_until(generation_deadline) => {
                let _ = worker.child.kill().await;
                let event = json!({
                    "type": if is_dynamic { "dynamic.failed" } else { "generation.failed" },
                    "jobId": job_id,
                    "sequence": last_sequence + 1,
                    "at": Utc::now().to_rfc3339(),
                    "error": {
                        "code": "timeout",
                        "message": if is_dynamic { "The live region update exceeded the five-minute deadline." } else { "The generation worker exceeded the five-minute deadline." },
                        "retryable": true
                    }
                });
                let stored_job_id = job_id.to_owned();
                let stored_profile_id = profile_id.to_owned();
                let stored_event_type = event["type"].as_str().unwrap_or("generation.failed").to_owned();
                let stored_sequence = event["sequence"].as_i64();
                let stored_timestamp = event["at"].as_str().unwrap_or("").to_owned();
                let stored_event = event.clone();
                let error_payload = event.get("error").cloned();
                let _ = storage.run(move |database| {
                    database.update_job(&stored_job_id, "failed", None, error_payload.as_ref())?;
                    database.record_job_event(
                        &stored_job_id, &stored_profile_id, &stored_event_type,
                        stored_sequence, &stored_timestamp, &stored_event,
                    )
                }).await;
                let _ = channel.send(event);
                terminal_event_seen = true;
                break;
            }
        }
    }

    if !terminal_event_seen {
        let status = worker.child.wait().await?;
        return Err(WorkerError::Protocol(format!(
            "worker exited before a terminal event ({status})"
        )));
    }
    if worker.child.try_wait()?.is_none() && reset_worker(&mut worker).await.is_ok() {
        manager.recycle(worker).await;
    } else {
        let _ = worker.child.kill().await;
    }
    Ok(())
}

async fn persist_model_exchanges(
    storage: &StorageHandle,
    job_id: &str,
    profile_id: &str,
    artifact: &ArtifactRecord,
) -> Result<(), WorkerError> {
    let Some(exchanges) = artifact
        .payload
        .get("modelExchanges")
        .and_then(Value::as_array)
    else {
        return Ok(());
    };
    for exchange in exchanges.iter().take(8) {
        let stage = exchange
            .get("purpose")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let started_at = exchange
            .get("startedAt")
            .and_then(Value::as_str)
            .unwrap_or(&artifact.created_at);
        let completed_at = exchange.get("completedAt").and_then(Value::as_str);
        let stored_job_id = job_id.to_owned();
        let stored_profile_id = profile_id.to_owned();
        let stored_stage = stage.to_owned();
        let stored_started_at = started_at.to_owned();
        let stored_completed_at = completed_at.map(str::to_owned);
        let stored_exchange = exchange.clone();
        storage
            .run(move |database| {
                database.upsert_generation_stage(GenerationStageWrite {
                    job_id: &stored_job_id,
                    profile_id: &stored_profile_id,
                    stage: &stored_stage,
                    status: "completed",
                    started_at: &stored_started_at,
                    completed_at: stored_completed_at.as_deref(),
                    payload: &stored_exchange,
                })
            })
            .await
            .map_err(|error| WorkerError::Protocol(error.to_string()))?;
    }
    Ok(())
}

async fn wait_for_deadline(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        sleep_until(deadline).await;
    } else {
        std::future::pending::<()>().await;
    }
}

fn worker_key(command: &WorkerCommand, codex_program: Option<&Path>) -> String {
    format!(
        "{}\u{0}{}\u{0}{}",
        command.program.display(),
        command.arguments.join("\u{1f}"),
        codex_program
            .map(|path| path.to_string_lossy())
            .unwrap_or_default(),
    )
}

async fn spawn_initialized_worker(
    command: &WorkerCommand,
    codex_program: Option<&Path>,
) -> Result<PooledWorker, WorkerError> {
    let mut child = spawn_worker(command, codex_program)?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| WorkerError::Spawn("worker stdin is unavailable".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| WorkerError::Spawn("worker stdout is unavailable".into()))?;
    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while matches!(lines.next_line().await, Ok(Some(_))) {}
        });
    }
    let mut lines = BufReader::new(stdout).lines();
    let initialize_id = send_initialize(&mut stdin).await?;
    await_initialized(&mut lines, &initialize_id).await?;
    Ok(PooledWorker {
        key: worker_key(command, codex_program),
        child,
        stdin,
        lines,
    })
}

async fn reset_worker(worker: &mut PooledWorker) -> Result<(), WorkerError> {
    let request_id = Uuid::new_v4().to_string();
    send_message(
        &mut worker.stdin,
        &ResetMessage {
            message_type: "reset",
            request_id: &request_id,
        },
    )
    .await?;
    tokio::time::timeout(RESET_TIMEOUT, async {
        while let Some(line) = worker.lines.next_line().await? {
            if line.len() > MAX_WORKER_LINE_BYTES {
                return Err(WorkerError::Protocol("worker line exceeds limit".into()));
            }
            let mut event: Value = serde_json::from_str(&line)?;
            redact_sensitive_fields(&mut event);
            if event.get("requestId").and_then(Value::as_str) != Some(&request_id) {
                continue;
            }
            if event.get("type").and_then(Value::as_str) == Some("ack")
                && event.get("accepted").and_then(Value::as_bool) == Some(true)
            {
                return Ok(());
            }
            return Err(WorkerError::Protocol("worker rejected reset".into()));
        }
        Err(WorkerError::Protocol(
            "worker exited before reset completed".into(),
        ))
    })
    .await
    .map_err(|_| WorkerError::Protocol("worker reset timed out".into()))?
}

fn spawn_worker(
    command: &WorkerCommand,
    codex_program: Option<&Path>,
) -> Result<tokio::process::Child, WorkerError> {
    let mut process = Command::new(&command.program);
    process.args(&command.arguments);
    process.env_remove("VIBESURFER_CODEX_PATH");
    if let Some(program) = codex_program {
        process.env("VIBESURFER_CODEX_PATH", program);
    }
    process
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| WorkerError::Spawn(error.to_string()))
}

async fn send_initialize(stdin: &mut ChildStdin) -> Result<String, WorkerError> {
    let request_id = Uuid::new_v4().to_string();
    let message = InitializeMessage {
        message_type: "initialize",
        request_id: request_id.clone(),
        protocol_version: WORKER_PROTOCOL_VERSION,
        client: WorkerClient {
            name: "vibesurfer",
            version: env!("CARGO_PKG_VERSION"),
        },
    };
    send_message(stdin, &message).await?;
    Ok(request_id)
}

async fn await_initialized<R>(lines: &mut Lines<R>, request_id: &str) -> Result<(), WorkerError>
where
    R: AsyncBufRead + Unpin,
{
    tokio::time::timeout(INITIALIZE_TIMEOUT, async {
        while let Some(line) = lines.next_line().await? {
            if line.len() > MAX_WORKER_LINE_BYTES {
                return Err(WorkerError::Protocol("worker line exceeds limit".into()));
            }
            let mut event: Value = serde_json::from_str(&line)?;
            redact_sensitive_fields(&mut event);
            if event.get("requestId").and_then(Value::as_str) != Some(request_id) {
                continue;
            }
            if event.get("type").and_then(Value::as_str) != Some("initialized") {
                return Err(WorkerError::Protocol(
                    "worker rejected initialization".into(),
                ));
            }
            if event.get("protocolVersion").and_then(Value::as_u64)
                != Some(WORKER_PROTOCOL_VERSION as u64)
            {
                return Err(WorkerError::Protocol(
                    "worker protocol version mismatch".into(),
                ));
            }
            return Ok(());
        }
        Err(WorkerError::Protocol(
            "worker exited before initialization completed".into(),
        ))
    })
    .await
    .map_err(|_| WorkerError::Protocol("worker initialization timed out".into()))?
}

async fn send_message(stdin: &mut ChildStdin, value: &impl Serialize) -> Result<(), WorkerError> {
    let mut serialized = Zeroizing::new(serde_json::to_string(value)?);
    serialized.push('\n');
    stdin.write_all(serialized.as_bytes()).await?;
    stdin.flush().await?;
    Ok(())
}

fn ensure_artifact_host_fields(artifact: &mut Value, profile_id: &str, job_id: &str) {
    let Some(object) = artifact.as_object_mut() else {
        return;
    };
    // Profile and job ownership are host facts. Never trust a worker/provider
    // payload to choose either persistence scope or the active job binding.
    object.insert("profileId".into(), Value::String(profile_id.to_owned()));
    object.insert("generationId".into(), Value::String(job_id.to_owned()));
    object
        .entry("createdAt")
        .or_insert_with(|| Value::String(Utc::now().to_rfc3339()));
    let payload = object
        .entry("payload")
        .or_insert_with(|| Value::Object(Map::new()));
    if !payload.is_object() {
        *payload = Value::Object(Map::new());
    }
    payload
        .as_object_mut()
        .expect("payload was normalized to an object")
        .insert("generationId".into(), Value::String(job_id.to_owned()));
}

fn redact_sensitive_fields(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if is_sensitive_key(key) {
                    *value = Value::String("[redacted]".into());
                } else {
                    redact_sensitive_fields(value);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(redact_sensitive_fields),
        _ => {}
    }
}

fn validate_event_sequence(
    event_type: &str,
    event: &Value,
    last_sequence: &mut u64,
) -> Result<(), WorkerError> {
    if !event_type.starts_with("generation.") && !event_type.starts_with("dynamic.") {
        return Ok(());
    }
    let sequence = event
        .get("sequence")
        .and_then(Value::as_u64)
        .ok_or_else(|| WorkerError::Protocol("generation event has no sequence".into()))?;
    if sequence <= *last_sequence {
        return Err(WorkerError::Protocol(
            "generation event sequence is not monotonic".into(),
        ));
    }
    *last_sequence = sequence;
    Ok(())
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['_', '-'], "");
    matches!(
        normalized.as_str(),
        "credential" | "apikey" | "secret" | "token" | "authorization"
    )
}

fn packaged_worker_names() -> Vec<&'static str> {
    if cfg!(target_os = "windows") {
        vec!["vibesurfer-generation-worker.exe", "generation-worker.exe"]
    } else {
        vec!["vibesurfer-generation-worker", "generation-worker"]
    }
}

fn command_available(command: &str) -> bool {
    std::process::Command::new(command)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InitializeMessage<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    request_id: String,
    protocol_version: u32,
    client: WorkerClient<'a>,
}

#[derive(Serialize)]
struct WorkerClient<'a> {
    name: &'a str,
    version: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateMessage<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    request_id: &'a str,
    job_id: &'a str,
    request: &'a Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderVerifyMessage<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    request_id: &'a str,
    provider: &'a Value,
    credential: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelMessage<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    request_id: String,
    job_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetMessage<'a> {
    #[serde(rename = "type")]
    message_type: &'a str,
    request_id: &'a str,
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, path::PathBuf};

    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    use super::{
        await_initialized, discover_worker_command, ensure_artifact_host_fields,
        packaged_worker_names, redact_sensitive_fields, validate_event_sequence,
    };

    #[test]
    fn recursive_redaction_protects_event_channels() {
        let mut value = json!({
            "apiKey": "danger",
            "nested": { "authorization": "Bearer danger", "safe": "ok" },
            "items": [{ "secret": "danger" }]
        });
        redact_sensitive_fields(&mut value);
        assert_eq!(value["apiKey"], "[redacted]");
        assert_eq!(value["nested"]["authorization"], "[redacted]");
        assert_eq!(value["items"][0]["secret"], "[redacted]");
        assert_eq!(value["nested"]["safe"], "ok");
    }

    #[test]
    fn generation_sequences_must_increase() {
        let mut last = 0;
        validate_event_sequence("generation.phase", &json!({ "sequence": 1 }), &mut last).unwrap();
        assert!(validate_event_sequence(
            "generation.metadata",
            &json!({ "sequence": 1 }),
            &mut last
        )
        .is_err());
        assert!(validate_event_sequence(
            "generation.completed",
            &json!({ "sequence": 3 }),
            &mut last
        )
        .is_ok());
    }

    #[test]
    fn artifact_scope_and_job_binding_are_host_owned() {
        let mut artifact = json!({
            "profileId": "attacker-profile",
            "generationId": "attacker-job",
            "createdAt": "2026-01-01T00:00:00Z",
            "payload": { "generationId": "attacker-job" }
        });

        ensure_artifact_host_fields(&mut artifact, "personal", "job-current");

        assert_eq!(artifact["profileId"], "personal");
        assert_eq!(artifact["generationId"], "job-current");
        assert_eq!(artifact["payload"]["generationId"], "job-current");
        assert_eq!(artifact["createdAt"], "2026-01-01T00:00:00Z");
    }

    #[tokio::test]
    async fn initialization_checks_request_and_protocol_version() {
        let (client, mut server) = tokio::io::duplex(1024);
        server
            .write_all(
                b"{\"type\":\"initialized\",\"requestId\":\"init-test\",\"protocolVersion\":1}\n",
            )
            .await
            .unwrap();
        drop(server);
        let mut lines = BufReader::new(client).lines();
        await_initialized(&mut lines, "init-test").await.unwrap();
    }

    #[test]
    fn worker_discovery_prefers_explicit_then_packaged_locations() {
        let project_root = PathBuf::from("/workspace/vibesurfer");
        let executable_dir = PathBuf::from("/Applications/vibesurfer");
        let resource_dir = PathBuf::from("/Applications/vibesurfer/resources");
        let explicit = PathBuf::from("/opt/vibesurfer/custom-worker");
        let packaged = executable_dir.join(packaged_worker_names()[0]);
        let existing = HashSet::from([explicit.clone(), packaged]);

        let command = discover_worker_command(
            Some(explicit.clone()),
            Some(executable_dir),
            Some(resource_dir),
            &project_root,
            |path| existing.contains(path),
            || false,
        )
        .unwrap();

        assert_eq!(command.program, explicit);
        assert!(command.arguments.is_empty());

        let packaged = PathBuf::from("/Applications/vibesurfer").join(packaged_worker_names()[0]);
        let command = discover_worker_command(
            Some(PathBuf::from("/missing/custom-worker")),
            Some(PathBuf::from("/Applications/vibesurfer")),
            Some(PathBuf::from("/Applications/vibesurfer/resources")),
            &project_root,
            |path| path == packaged,
            || false,
        )
        .unwrap();
        assert_eq!(command.program, packaged);
    }

    #[test]
    fn worker_discovery_uses_compiled_script_before_source_fallback() {
        let project_root = PathBuf::from("/workspace/vibesurfer");
        let compiled = project_root.join("generation-worker/dist/index.js");
        let source = project_root.join("generation-worker/src/index.ts");
        let existing = HashSet::from([compiled.clone(), source]);

        let command = discover_worker_command(
            None,
            None,
            None,
            &project_root,
            |path| existing.contains(path),
            || true,
        )
        .unwrap();

        assert_eq!(command.program, PathBuf::from("node"));
        assert_eq!(command.arguments, vec![compiled.display().to_string()]);
    }

    #[test]
    fn worker_discovery_requires_bun_for_typescript_source() {
        let project_root = PathBuf::from("/workspace/vibesurfer");
        let source = project_root.join("generation-worker/src/index.ts");

        let unavailable = discover_worker_command(
            None,
            None,
            None,
            &project_root,
            |path| path == source,
            || false,
        );
        assert!(unavailable.is_err());

        let command = discover_worker_command(
            None,
            None,
            None,
            &project_root,
            |path| path == source,
            || true,
        )
        .unwrap();
        assert_eq!(command.program, PathBuf::from("bun"));
        assert_eq!(command.arguments, vec!["run", source.to_str().unwrap()]);
    }
}
