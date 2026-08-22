use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
};

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::{io::AsyncWriteExt, process::Command};

const MAX_SIDECAR_AUDIO_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct MediaWorkerCommand {
    pub program: PathBuf,
    pub arguments: Vec<String>,
    pub runtime_directory: Option<PathBuf>,
}

pub fn discover(app: &AppHandle) -> Result<MediaWorkerCommand, String> {
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "media worker project root cannot be resolved".to_owned())?;
    let executable_directory = std::env::current_exe().ok().and_then(|path| path.parent().map(Path::to_path_buf));
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

pub async fn render(command: &MediaWorkerCommand, model_root: &Path, request: &Value) -> Result<Vec<u8>, String> {
    let payload = serde_json::to_vec(request).map_err(|error| format!("could not serialize local speech request: {error}"))?;
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
    let mut child = process.spawn().map_err(|error| format!("could not start local speech worker: {error}"))?;
    let mut stdin = child.stdin.take().ok_or_else(|| "local speech worker stdin is unavailable".to_owned())?;
    stdin.write_all(&payload).await.map_err(|error| format!("could not send local speech request: {error}"))?;
    stdin.shutdown().await.map_err(|error| format!("could not finish local speech request: {error}"))?;
    drop(stdin);
    let output = child.wait_with_output().await.map_err(|error| format!("local speech worker failed: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).split_whitespace().collect::<Vec<_>>().join(" ");
        return Err(format!("local speech worker failed: {}", message.chars().take(512).collect::<String>()));
    }
    if output.stdout.len() < 44 || output.stdout.len() > MAX_SIDECAR_AUDIO_BYTES {
        return Err("local speech worker returned invalid or oversized audio".into());
    }
    Ok(output.stdout)
}

fn discover_with(
    explicit: Option<PathBuf>,
    executable_directory: Option<PathBuf>,
    resource_directory: Option<PathBuf>,
    project_root: &Path,
    is_file: impl Fn(&Path) -> bool,
    bun_available: impl Fn() -> bool,
) -> Result<MediaWorkerCommand, String> {
    let runtime_directory = runtime_directories(executable_directory.as_deref(), resource_directory.as_deref())
        .into_iter()
        .find(|directory| directory.is_dir());
    if let Some(program) = explicit.filter(|path| is_file(path)) {
        return Ok(MediaWorkerCommand { program, arguments: Vec::new(), runtime_directory });
    }
    for directory in [executable_directory.as_deref(), resource_directory.as_deref()].into_iter().flatten() {
        for name in packaged_names() {
            let candidate = directory.join(name);
            if is_file(&candidate) {
                return Ok(MediaWorkerCommand { program: candidate, arguments: Vec::new(), runtime_directory });
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

fn runtime_directories(executable_directory: Option<&Path>, resource_directory: Option<&Path>) -> Vec<PathBuf> {
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
    let mut names = vec![format!("vibesurfer-media-worker{}", std::env::consts::EXE_SUFFIX)];
    let target = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    };
    if let Some(target) = target {
        names.push(format!("vibesurfer-media-worker-{target}{}", std::env::consts::EXE_SUFFIX));
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
        ).unwrap();
        assert_eq!(command.program, PathBuf::from("/trusted/media-worker"));
        assert!(command.arguments.is_empty());
    }

    #[test]
    fn source_fallback_requires_bun() {
        let root = PathBuf::from("/project");
        let missing = discover_with(None, None, None, &root, |path| path.ends_with("kokoro-sidecar.ts"), || false);
        assert!(missing.is_err());
        let command = discover_with(None, None, None, &root, |path| path.ends_with("kokoro-sidecar.ts"), || true).unwrap();
        assert_eq!(command.program, PathBuf::from("bun"));
    }
}
