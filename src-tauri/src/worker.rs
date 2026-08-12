use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{ipc::Channel, AppHandle, Manager};
use thiserror::Error;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{ChildStdin, Command},
    sync::{mpsc, Mutex},
    time::{sleep_until, Instant},
};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    protocol::{ArtifactRecord, GenerationStartRequest, WORKER_PROTOCOL_VERSION},
    storage::Storage,
};

const CANCEL_GRACE: Duration = Duration::from_secs(5);
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(10);
const GENERATION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_WORKER_LINE_BYTES: usize = 6 * 1024 * 1024;

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

impl WorkerManager {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn active_job_count(&self) -> usize {
        self.jobs.lock().await.len()
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
        storage: Arc<Storage>,
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
        tauri::async_runtime::spawn(async move {
            let outcome = run_generation(
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
                    "type": "generation.failed",
                    "jobId": task_job_id,
                    "error": {
                        "code": "worker-crashed",
                        "message": error.to_string(),
                        "retryable": true
                    }
                });
                let _ = storage.update_job(
                    payload["jobId"].as_str().unwrap_or_default(),
                    "failed",
                    None,
                    payload.get("error"),
                );
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
        let command = Self::discover(app)?;
        let mut child = spawn_worker(&command, None)?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| WorkerError::Spawn("worker stdin is unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| WorkerError::Spawn("worker stdout is unavailable".into()))?;
        let mut lines = BufReader::new(stdout).lines();
        let initialize_id = send_initialize(&mut stdin).await?;
        await_initialized(&mut lines, &initialize_id).await?;

        let request_id = Uuid::new_v4().to_string();
        let request = ProviderVerifyMessage {
            message_type: "provider.verify",
            request_id: &request_id,
            provider,
            credential,
        };
        send_message(&mut stdin, &request).await?;

        let result = tokio::time::timeout(Duration::from_secs(30), async {
            while let Some(line) = lines.next_line().await? {
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
        .map_err(|_| WorkerError::Protocol("provider verification timed out".into()))??;
        let _ = child.kill().await;
        Ok(result)
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
    app: &AppHandle,
    storage: Arc<Storage>,
    job_id: &str,
    profile_id: &str,
    request: &Value,
    credential: Option<&str>,
    codex_program: Option<&Path>,
    channel: Channel<Value>,
    mut control_rx: mpsc::Receiver<WorkerControl>,
) -> Result<(), WorkerError> {
    storage
        .mark_job_started(job_id, profile_id, request)
        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
    let command = WorkerManager::discover(app)?;
    let mut child = spawn_worker(&command, codex_program)?;
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
    let request_id = Uuid::new_v4().to_string();
    let generate = GenerateMessage {
        message_type: "generate",
        request_id: &request_id,
        job_id,
        request,
        credential,
    };
    send_message(&mut stdin, &generate).await?;

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
                    send_message(&mut stdin, &cancel).await?;
                    cancel_deadline = Some(Instant::now() + CANCEL_GRACE);
                }
            }
            line = lines.next_line() => {
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

                if event_type == "generation.completed" {
                    let mut artifact_value = event
                        .get("artifact")
                        .cloned()
                        .ok_or_else(|| WorkerError::Protocol("completed event has no artifact".into()))?;
                    ensure_artifact_host_fields(&mut artifact_value, profile_id, job_id);
                    let artifact: ArtifactRecord = serde_json::from_value(artifact_value.clone())?;
                    event["artifact"] = artifact_value;
                    storage
                        .save_artifact(&artifact)
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    storage
                        .update_job(job_id, "completed", Some(&artifact.id), None)
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    terminal_event_seen = true;
                } else if event_type == "generation.failed" {
                    storage
                        .update_job(job_id, "failed", None, event.get("error"))
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    terminal_event_seen = true;
                } else if event_type == "generation.cancelled" {
                    storage
                        .update_job(job_id, "cancelled", None, None)
                        .map_err(|error| WorkerError::Protocol(error.to_string()))?;
                    terminal_event_seen = true;
                } else if event_type == "generation.phase" {
                    if let Some(phase) = event.get("phase").and_then(Value::as_str) {
                        let _ = storage.update_job(job_id, phase, None, None);
                    }
                }

                let _ = channel.send(event);
                if terminal_event_seen { break; }
            }
            _ = wait_for_deadline(cancel_deadline), if cancel_deadline.is_some() => {
                let _ = child.kill().await;
                let event = json!({
                    "type": "generation.cancelled",
                    "jobId": job_id,
                    "sequence": last_sequence + 1,
                    "at": Utc::now().to_rfc3339()
                });
                let _ = storage.update_job(job_id, "cancelled", None, None);
                let _ = channel.send(event);
                terminal_event_seen = true;
                break;
            }
            _ = sleep_until(generation_deadline) => {
                let _ = child.kill().await;
                let event = json!({
                    "type": "generation.failed",
                    "jobId": job_id,
                    "sequence": last_sequence + 1,
                    "at": Utc::now().to_rfc3339(),
                    "error": {
                        "code": "timeout",
                        "message": "The generation worker exceeded the five-minute deadline.",
                        "retryable": true
                    }
                });
                let _ = storage.update_job(job_id, "failed", None, event.get("error"));
                let _ = channel.send(event);
                terminal_event_seen = true;
                break;
            }
        }
    }

    if !terminal_event_seen {
        let status = child.wait().await?;
        return Err(WorkerError::Protocol(format!(
            "worker exited before a terminal event ({status})"
        )));
    }
    let _ = child.kill().await;
    Ok(())
}

async fn wait_for_deadline(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        sleep_until(deadline).await;
    } else {
        std::future::pending::<()>().await;
    }
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
    if !event_type.starts_with("generation.") {
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
        let executable_dir = PathBuf::from("/Applications/VibeSurfer");
        let resource_dir = PathBuf::from("/Applications/VibeSurfer/resources");
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

        let packaged = PathBuf::from("/Applications/VibeSurfer").join(packaged_worker_names()[0]);
        let command = discover_worker_command(
            Some(PathBuf::from("/missing/custom-worker")),
            Some(PathBuf::from("/Applications/VibeSurfer")),
            Some(PathBuf::from("/Applications/VibeSurfer/resources")),
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
