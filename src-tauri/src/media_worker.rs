use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;

const MAX_SIDECAR_AUDIO_BYTES: usize = 64 * 1024 * 1024;
const MAX_SIDECAR_HEADER_BYTES: usize = 4 * 1024;
const SIDECAR_START_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Debug)]
pub struct MediaWorkerCommand {
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub runtime_directory: Option<PathBuf>,
}

#[derive(Clone)]
pub struct MediaWorkerManager {
    idle: Arc<Mutex<Option<MediaWorkerProcess>>>,
    capacity: Arc<Semaphore>,
    spawned: Arc<AtomicU64>,
    reused: Arc<AtomicU64>,
}

struct MediaWorkerProcess {
    key: String,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl MediaWorkerManager {
    pub fn new() -> Self {
        Self {
            idle: Arc::new(Mutex::new(None)),
            capacity: Arc::new(Semaphore::new(1)),
            spawned: Arc::new(AtomicU64::new(0)),
            reused: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn spawned_count(&self) -> u64 {
        self.spawned.load(Ordering::Relaxed)
    }

    pub fn reused_count(&self) -> u64 {
        self.reused.load(Ordering::Relaxed)
    }

    pub async fn render(
        &self,
        command: &MediaWorkerCommand,
        model_root: &Path,
        request: &Value,
    ) -> Result<Vec<u8>, String> {
        let _permit = self
            .capacity
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| "local speech worker is shutting down".to_owned())?;
        let key = process_key(command, model_root);
        let candidate = self.idle.lock().await.take();
        let mut worker = if let Some(mut worker) = candidate {
            let healthy = worker.key == key
                && worker
                    .child
                    .try_wait()
                    .map_err(|error| format!("could not inspect local speech worker: {error}"))?
                    .is_none();
            if healthy {
                self.reused.fetch_add(1, Ordering::Relaxed);
                worker
            } else {
                let _ = worker.child.kill().await;
                self.spawn(command, model_root, key).await?
            }
        } else {
            self.spawn(command, model_root, key).await?
        };

        let result = render_on_process(&mut worker, request).await;
        if result.is_ok() {
            *self.idle.lock().await = Some(worker);
        } else {
            let _ = worker.child.kill().await;
        }
        result
    }

    async fn spawn(
        &self,
        command: &MediaWorkerCommand,
        model_root: &Path,
        key: String,
    ) -> Result<MediaWorkerProcess, String> {
        let mut process = Command::new(&command.program);
        process
            .args(&command.arguments)
            .arg(model_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(directory) = &command.runtime_directory {
            prepend_runtime_library_path(&mut process, directory);
        }
        let mut child = process
            .spawn()
            .map_err(|error| format!("could not start local speech worker: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "local speech worker stdin is unavailable".to_owned())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "local speech worker stdout is unavailable".to_owned())?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while matches!(lines.next_line().await, Ok(Some(_))) {}
            });
        }
        let mut worker = MediaWorkerProcess {
            key,
            child,
            stdin,
            stdout: BufReader::new(stdout),
        };
        let mut ready = String::new();
        tokio::time::timeout(SIDECAR_START_TIMEOUT, worker.stdout.read_line(&mut ready))
            .await
            .map_err(|_| "local speech worker startup timed out".to_owned())?
            .map_err(|error| format!("could not read local speech worker startup: {error}"))?;
        let payload: Value = serde_json::from_str(&ready)
            .map_err(|_| "local speech worker returned an invalid startup response".to_owned())?;
        if ready.len() > MAX_SIDECAR_HEADER_BYTES
            || payload.get("type").and_then(Value::as_str) != Some("ready")
            || payload.get("protocolVersion").and_then(Value::as_u64) != Some(1)
        {
            return Err("local speech worker protocol mismatch".into());
        }
        self.spawned.fetch_add(1, Ordering::Relaxed);
        Ok(worker)
    }
}

pub fn discover(app: &AppHandle) -> Result<MediaWorkerCommand, String> {
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "media worker project root cannot be resolved".to_owned())?;
    let executable_directory = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let resource_directory = app.path().resource_dir().ok();
    discover_with(
        std::env::var_os("VIBESURFER_MEDIA_WORKER").map(PathBuf::from),
        executable_directory,
        resource_directory,
        project_root,
        Path::is_file,
        || command_available("bun"),
    )
}

async fn render_on_process(
    worker: &mut MediaWorkerProcess,
    request: &Value,
) -> Result<Vec<u8>, String> {
    let request_id = Uuid::new_v4().to_string();
    let mut payload = request.clone();
    payload
        .as_object_mut()
        .ok_or_else(|| "local speech request must be an object".to_owned())?
        .insert("requestId".into(), Value::String(request_id.clone()));
    let mut serialized = serde_json::to_vec(&payload)
        .map_err(|error| format!("could not serialize local speech request: {error}"))?;
    serialized.push(b'\n');
    worker
        .stdin
        .write_all(&serialized)
        .await
        .map_err(|error| format!("could not send local speech request: {error}"))?;
    worker
        .stdin
        .flush()
        .await
        .map_err(|error| format!("could not flush local speech request: {error}"))?;

    let mut header = String::new();
    let bytes_read = worker
        .stdout
        .read_line(&mut header)
        .await
        .map_err(|error| format!("could not read local speech response: {error}"))?;
    if bytes_read == 0 || header.len() > MAX_SIDECAR_HEADER_BYTES {
        return Err("local speech worker returned an invalid response header".into());
    }
    let response: Value = serde_json::from_str(&header)
        .map_err(|_| "local speech worker returned invalid JSON".to_owned())?;
    if response.get("requestId").and_then(Value::as_str) != Some(&request_id) {
        return Err("local speech worker response id mismatch".into());
    }
    if response.get("type").and_then(Value::as_str) == Some("error") {
        return Err(response
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("local speech worker failed")
            .chars()
            .take(512)
            .collect());
    }
    let byte_length = response
        .get("byteLength")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| (44..=MAX_SIDECAR_AUDIO_BYTES).contains(value))
        .ok_or_else(|| "local speech worker returned invalid or oversized audio".to_owned())?;
    let mut audio = vec![0_u8; byte_length];
    worker
        .stdout
        .read_exact(&mut audio)
        .await
        .map_err(|error| format!("could not read local speech audio: {error}"))?;
    Ok(audio)
}

fn process_key(command: &MediaWorkerCommand, model_root: &Path) -> String {
    format!(
        "{}\u{0}{}\u{0}{}",
        command.program.display(),
        command.arguments.join("\u{1f}"),
        model_root.display()
    )
}

fn discover_with(
    explicit: Option<PathBuf>,
    executable_directory: Option<PathBuf>,
    resource_directory: Option<PathBuf>,
    project_root: &Path,
    is_file: impl Fn(&Path) -> bool,
    bun_available: impl Fn() -> bool,
) -> Result<MediaWorkerCommand, String> {
    let runtime_directory = runtime_directories(
        executable_directory.as_deref(),
        resource_directory.as_deref(),
    )
    .into_iter()
    .find(|directory| directory.is_dir());
    if let Some(program) = explicit.filter(|path| is_file(path)) {
        return Ok(MediaWorkerCommand {
            program,
            arguments: Vec::new(),
            runtime_directory,
        });
    }
    for directory in [
        executable_directory.as_deref(),
        resource_directory.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        for name in packaged_names() {
            let candidate = directory.join(name);
            if is_file(&candidate) {
                return Ok(MediaWorkerCommand {
                    program: candidate,
                    arguments: Vec::new(),
                    runtime_directory,
                });
            }
        }
    }
    let compiled_directory = project_root.join("src-tauri/sidecars");
    for name in packaged_names() {
        let candidate = compiled_directory.join(name);
        if is_file(&candidate) {
            let development_runtime = compiled_directory.join("media-runtime");
            return Ok(MediaWorkerCommand {
                program: candidate,
                arguments: Vec::new(),
                runtime_directory: development_runtime.is_dir().then_some(development_runtime),
            });
        }
    }
    let source = project_root.join("src/media/kokoro-sidecar.ts");
    if is_file(&source) && bun_available() {
        return Ok(MediaWorkerCommand {
            program: PathBuf::from("bun"),
            arguments: vec!["run".into(), source.display().to_string()],
            runtime_directory: None,
        });
    }
    Err("the packaged local speech worker is unavailable".into())
}

fn runtime_directories(
    executable_directory: Option<&Path>,
    resource_directory: Option<&Path>,
) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(resource) = resource_directory {
        directories.push(resource.join("media-runtime"));
        directories.push(resource.join("sidecars/media-runtime"));
    }
    if let Some(executable) = executable_directory {
        directories.push(executable.join("media-runtime"));
        if let Some(contents) = executable.parent() {
            directories.push(contents.join("Resources/media-runtime"));
            directories.push(contents.join("Resources/sidecars/media-runtime"));
        }
    }
    directories
}

fn packaged_names() -> Vec<String> {
    let mut names = vec![format!(
        "vibesurfer-media-worker{}",
        std::env::consts::EXE_SUFFIX
    )];
    let target = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    };
    if let Some(target) = target {
        names.push(format!(
            "vibesurfer-media-worker-{target}{}",
            std::env::consts::EXE_SUFFIX
        ));
    }
    names
}

fn prepend_runtime_library_path(command: &mut Command, directory: &Path) {
    #[cfg(target_os = "macos")]
    let variable = "DYLD_LIBRARY_PATH";
    #[cfg(target_os = "linux")]
    let variable = "LD_LIBRARY_PATH";
    #[cfg(target_os = "windows")]
    let variable = "PATH";
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let variable = "PATH";
    let mut paths = vec![directory.to_path_buf()];
    if let Some(existing) = std::env::var_os(variable) {
        paths.extend(std::env::split_paths(&existing));
    }
    let joined = std::env::join_paths(paths).unwrap_or_else(|_| OsString::from(directory));
    command.env(variable, joined);
}

fn command_available(program: &str) -> bool {
    std::process::Command::new(program)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_media_worker_wins_without_accepting_an_unresolved_path() {
        let root = PathBuf::from("/project");
        let command = discover_with(
            Some(PathBuf::from("/trusted/media-worker")),
            None,
            None,
            &root,
            |path| path == Path::new("/trusted/media-worker"),
            || false,
        )
        .unwrap();
        assert_eq!(command.program, PathBuf::from("/trusted/media-worker"));
        assert!(command.arguments.is_empty());
    }

    #[test]
    fn source_fallback_requires_bun() {
        let root = PathBuf::from("/project");
        let missing = discover_with(
            None,
            None,
            None,
            &root,
            |path| path.ends_with("kokoro-sidecar.ts"),
            || false,
        );
        assert!(missing.is_err());
        let command = discover_with(
            None,
            None,
            None,
            &root,
            |path| path.ends_with("kokoro-sidecar.ts"),
            || true,
        )
        .unwrap();
        assert_eq!(command.program, PathBuf::from("bun"));
    }
}
