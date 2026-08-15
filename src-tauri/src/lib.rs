mod codex_adapter;
mod native_menu;
mod protocol;
mod secrets;
mod storage;
mod worker;

use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

use codex_adapter::CodexCatalog;
use native_menu::{build_native_menu, emit_native_menu_command, update_native_menu_state};
use protocol::{
    ArtifactRecord, GenerationStartRequest, GenerationStartResult, ProviderConnectionRecord,
    ProviderVerifyRequest, RuntimeStatus, SiteWorldRecord, WORKER_PROTOCOL_VERSION,
};
use secrets::SecretVault;
use serde::Serialize;
use serde_json::{json, Value};
use storage::Storage;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use worker::WorkerManager;
use zeroize::Zeroizing;

struct AppRuntime {
    storage: Arc<Storage>,
    secrets: SecretVault,
    worker: WorkerManager,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAuthStatus {
    available: bool,
    healthy: bool,
    authenticated: bool,
    message: String,
}

#[derive(Debug, PartialEq, Eq)]
enum CodexProbeState {
    Authenticated,
    SignedOut,
    Unhealthy,
    Unavailable,
}

#[derive(Debug)]
struct CodexProbe {
    state: CodexProbeState,
    message: String,
}

#[derive(Debug)]
struct CodexDiscovery {
    status: CodexAuthStatus,
    program: Option<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretStatus {
    secret_ref: String,
    configured: bool,
}

fn provider_connection_id(provider: &Value) -> Result<&str, String> {
    let id = provider.get("id").and_then(Value::as_str);
    let connection_id = provider.get("connectionId").and_then(Value::as_str);
    if matches!((id, connection_id), (Some(id), Some(connection_id)) if id != connection_id) {
        return Err("provider id and connectionId do not match".into());
    }
    connection_id
        .or(id)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "provider connection id is required".into())
}

fn bound_provider_record(
    runtime: &AppRuntime,
    profile_id: &str,
    connection_id: &str,
    secret_ref: &str,
) -> Result<ProviderConnectionRecord, String> {
    runtime
        .secrets
        .ensure_connection_scope(profile_id, connection_id, secret_ref)
        .map_err(|error| error.to_string())?;
    let provider = runtime
        .storage
        .list_providers(profile_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|provider| provider.id == connection_id)
        .ok_or_else(|| "provider connection was not found".to_owned())?;
    if provider.secret_ref != secret_ref {
        return Err("provider credential reference does not match the stored connection".into());
    }
    Ok(provider)
}

fn provider_for_worker(
    provider: &ProviderConnectionRecord,
    requested: &Value,
) -> Result<Value, String> {
    let requested_model = requested
        .get("modelId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "provider model id is required".to_owned())?;
    if let Some(model_ids) = provider.payload.get("modelIds").and_then(Value::as_array) {
        let allowed = model_ids.iter().filter_map(Value::as_str).any(|stored| {
            stored == requested_model
                || stored
                    .split_once(':')
                    .is_some_and(|(_, model)| model == requested_model)
        });
        if !model_ids.is_empty() && !allowed {
            return Err("requested model does not belong to the provider connection".into());
        }
    }
    let generation_mode = provider
        .payload
        .get("generationMode")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "directed" | "compact"))
        .unwrap_or(if provider.kind == "openai-compatible" {
            "compact"
        } else {
            "directed"
        });
    Ok(json!({
        "id": provider.id,
        "connectionId": provider.id,
        "kind": provider.kind,
        "displayName": provider.display_name,
        "baseUrl": provider.base_url,
        "modelId": requested_model,
        "generationMode": generation_mode,
        "supportsStructuredOutputs": generation_mode == "directed",
    }))
}

fn delete_secret_before_provider_record(
    delete_secret: impl FnOnce() -> Result<(), String>,
    delete_provider: impl FnOnce() -> Result<usize, String>,
) -> Result<(), String> {
    delete_secret()?;
    let removed = delete_provider()?;
    if removed == 0 {
        Err("provider connection was not found".into())
    } else {
        Ok(())
    }
}

fn push_unique_codex_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn codex_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(program) = env::var_os("VIBESURFER_CODEX_PATH").filter(|value| !value.is_empty()) {
        push_unique_codex_candidate(&mut candidates, PathBuf::from(program));
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME") {
            let program =
                PathBuf::from(home).join("Applications/ChatGPT.app/Contents/Resources/codex");
            if program.is_file() {
                push_unique_codex_candidate(&mut candidates, program);
            }
        }

        let program = PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex");
        if program.is_file() {
            push_unique_codex_candidate(&mut candidates, program);
        }
    }

    push_unique_codex_candidate(&mut candidates, PathBuf::from("codex"));
    candidates
}

fn codex_output_message(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if stdout.is_empty() {
        stderr
    } else {
        stdout
    }
}

fn probe_codex(program: &Path) -> CodexProbe {
    match Command::new(program).args(["login", "status"]).output() {
        Ok(output) => {
            let message = codex_output_message(&output);
            if output.status.success() {
                CodexProbe {
                    state: CodexProbeState::Authenticated,
                    message: if message.is_empty() {
                        "Logged in using Codex".into()
                    } else {
                        message
                    },
                }
            } else if message.to_lowercase().contains("not logged in") {
                CodexProbe {
                    state: CodexProbeState::SignedOut,
                    message,
                }
            } else {
                CodexProbe {
                    state: CodexProbeState::Unhealthy,
                    message: if message.is_empty() {
                        "Codex login status failed without an error message.".into()
                    } else {
                        message
                    },
                }
            }
        }
        Err(error) => CodexProbe {
            state: CodexProbeState::Unavailable,
            message: error.to_string(),
        },
    }
}

fn discover_codex_with(
    candidates: Vec<PathBuf>,
    mut probe: impl FnMut(&Path) -> CodexProbe,
) -> CodexDiscovery {
    let mut signed_out = None;
    let mut unhealthy = Vec::new();
    let mut unavailable = Vec::new();

    for program in candidates {
        let result = probe(&program);
        match result.state {
            CodexProbeState::Authenticated => {
                return CodexDiscovery {
                    status: CodexAuthStatus {
                        available: true,
                        healthy: true,
                        authenticated: true,
                        message: result.message,
                    },
                    program: Some(program),
                };
            }
            CodexProbeState::SignedOut => {
                if signed_out.is_none() {
                    signed_out = Some((program, result.message));
                }
            }
            CodexProbeState::Unhealthy => {
                unhealthy.push(format!("{}: {}", program.display(), result.message));
            }
            CodexProbeState::Unavailable => {
                unavailable.push(format!("{}: {}", program.display(), result.message));
            }
        }
    }

    if let Some((program, message)) = signed_out {
        return CodexDiscovery {
            status: CodexAuthStatus {
                available: true,
                healthy: true,
                authenticated: false,
                message,
            },
            program: Some(program),
        };
    }

    if let Some(message) = unhealthy.into_iter().next() {
        return CodexDiscovery {
            status: CodexAuthStatus {
                available: true,
                healthy: false,
                authenticated: false,
                message: format!(
                    "No compatible Codex CLI could read the system session. {message}"
                ),
            },
            program: None,
        };
    }

    let detail = unavailable
        .into_iter()
        .next()
        .unwrap_or_else(|| "no Codex CLI candidates were found".into());
    CodexDiscovery {
        status: CodexAuthStatus {
            available: false,
            healthy: false,
            authenticated: false,
            message: format!("Codex CLI is unavailable: {detail}"),
        },
        program: None,
    }
}

fn discover_codex() -> CodexDiscovery {
    discover_codex_with(codex_candidates(), probe_codex)
}

#[tauri::command]
fn codex_auth_status() -> CodexAuthStatus {
    discover_codex().status
}

#[tauri::command]
async fn codex_model_catalog() -> Result<CodexCatalog, String> {
    let discovery = discover_codex();
    if !discovery.status.authenticated {
        return Err(discovery.status.message);
    }
    let program = discovery
        .program
        .ok_or_else(|| "No compatible Codex installation was found.".to_owned())?;
    if !codex_adapter::supports_hardened_exec(&program) {
        return Err(
            "This Codex installation is signed in, but it is too old for safe page generation. Update ChatGPT or Codex and try again."
                .into(),
        );
    }
    codex_adapter::load_catalog(&program)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_codex_login() -> Result<(), String> {
    let discovery = discover_codex();
    let program = discovery
        .program
        .ok_or_else(|| discovery.status.message.clone())?;
    if discovery.status.authenticated {
        return Ok(());
    }
    Command::new(program)
        .arg("login")
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start Codex login: {error}"))
}

#[tauri::command]
async fn runtime_status(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> Result<RuntimeStatus, String> {
    let worker = WorkerManager::discover(&app);
    Ok(RuntimeStatus {
        protocol_version: WORKER_PROTOCOL_VERSION,
        worker_available: worker.is_ok(),
        worker_description: worker
            .map(|command| command.description)
            .unwrap_or_else(|error| error.to_string()),
        active_jobs: runtime.worker.active_job_count().await,
        storage_ready: true,
    })
}

#[tauri::command]
fn put_provider_secret(
    profile_id: String,
    connection_id: String,
    secret: String,
    runtime: State<'_, AppRuntime>,
) -> Result<String, String> {
    runtime
        .secrets
        .put(&profile_id, &connection_id, Zeroizing::new(secret))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn provider_secret_status(
    secret_ref: String,
    runtime: State<'_, AppRuntime>,
) -> Result<SecretStatus, String> {
    runtime
        .secrets
        .exists(&secret_ref)
        .map(|configured| SecretStatus {
            secret_ref,
            configured,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_provider_secret(
    secret_ref: String,
    runtime: State<'_, AppRuntime>,
) -> Result<(), String> {
    runtime
        .secrets
        .delete(&secret_ref)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_artifact(artifact: ArtifactRecord, runtime: State<'_, AppRuntime>) -> Result<(), String> {
    runtime
        .storage
        .save_artifact(&artifact)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_artifact(
    id: String,
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<Option<ArtifactRecord>, String> {
    runtime
        .storage
        .artifact(&id, &profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_cached_artifact(
    profile_id: String,
    site_id: String,
    url: String,
    runtime: State<'_, AppRuntime>,
) -> Result<Option<ArtifactRecord>, String> {
    runtime
        .storage
        .latest_artifact_for_url(&profile_id, &site_id, &url)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_artifacts(
    profile_id: String,
    limit: Option<usize>,
    runtime: State<'_, AppRuntime>,
) -> Result<Vec<ArtifactRecord>, String> {
    runtime
        .storage
        .list_artifacts(&profile_id, limit.unwrap_or(32))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_profile_artifacts(
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<usize, String> {
    runtime
        .storage
        .delete_profile_artifacts(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_site_world(
    site_world: SiteWorldRecord,
    runtime: State<'_, AppRuntime>,
) -> Result<bool, String> {
    runtime
        .storage
        .upsert_site_world(&site_world)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_site_world(
    id: String,
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<Option<SiteWorldRecord>, String> {
    runtime
        .storage
        .site_world(&id, &profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_site_worlds(
    profile_id: String,
    limit: Option<usize>,
    runtime: State<'_, AppRuntime>,
) -> Result<Vec<SiteWorldRecord>, String> {
    runtime
        .storage
        .list_site_worlds(&profile_id, limit.unwrap_or(500))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_site_world(
    id: String,
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<usize, String> {
    runtime
        .storage
        .delete_site_world(&id, &profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_profile_site_worlds(
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<usize, String> {
    runtime
        .storage
        .delete_profile_site_worlds(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn archive_profile_site_worlds(
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<usize, String> {
    runtime
        .storage
        .archive_profile_site_worlds(&profile_id, &chrono::Utc::now().to_rfc3339())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn activate_site_world(
    profile_id: String,
    id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<bool, String> {
    runtime
        .storage
        .activate_site_world(&profile_id, &id, &chrono::Utc::now().to_rfc3339())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_profile_data(
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<usize, String> {
    let providers = runtime
        .storage
        .list_providers(&profile_id)
        .map_err(|error| error.to_string())?;
    for provider in &providers {
        runtime
            .secrets
            .delete(&provider.secret_ref)
            .map_err(|error| error.to_string())?;
    }
    runtime
        .storage
        .delete_profile_data(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_provider_connection(
    provider: ProviderConnectionRecord,
    runtime: State<'_, AppRuntime>,
) -> Result<(), String> {
    runtime
        .secrets
        .ensure_connection_scope(&provider.profile_id, &provider.id, &provider.secret_ref)
        .map_err(|error| error.to_string())?;
    if !runtime
        .secrets
        .exists(&provider.secret_ref)
        .map_err(|error| error.to_string())?
    {
        return Err("provider credential was not found".into());
    }
    if let Some(existing) = runtime
        .storage
        .list_providers(&provider.profile_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|existing| existing.id == provider.id)
    {
        if existing.kind != provider.kind
            || existing.base_url != provider.base_url
            || existing.secret_ref != provider.secret_ref
        {
            return Err(
                "provider security settings cannot be changed without replacing the connection"
                    .into(),
            );
        }
    }
    runtime
        .storage
        .upsert_provider(&provider)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_provider_connections(
    profile_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<Vec<ProviderConnectionRecord>, String> {
    runtime
        .storage
        .list_providers(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_provider_connection(
    id: String,
    profile_id: String,
    secret_ref: String,
    runtime: State<'_, AppRuntime>,
) -> Result<(), String> {
    bound_provider_record(&runtime, &profile_id, &id, &secret_ref)?;
    delete_secret_before_provider_record(
        || {
            runtime
                .secrets
                .delete(&secret_ref)
                .map_err(|error| error.to_string())
        },
        || {
            runtime
                .storage
                .delete_provider(&id, &profile_id)
                .map_err(|error| error.to_string())
        },
    )
}

#[tauri::command]
async fn verify_provider_connection(
    request: ProviderVerifyRequest,
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> Result<Value, String> {
    let connection_id = provider_connection_id(&request.provider)?.to_owned();
    let provider_record = bound_provider_record(
        &runtime,
        &request.profile_id,
        &connection_id,
        &request.credential_ref,
    )?;
    let provider = provider_for_worker(&provider_record, &request.provider)?;
    let credential = runtime
        .secrets
        .get(&request.credential_ref)
        .map_err(|error| error.to_string())?;
    let result = runtime
        .worker
        .verify_provider(&app, &provider, credential.as_str())
        .await;
    let (status, verified_at) = if result.is_ok() {
        ("valid", Some(chrono::Utc::now().to_rfc3339()))
    } else {
        ("invalid", None)
    };
    runtime
        .storage
        .update_provider_status(&provider_record.id, status, verified_at.as_deref())
        .map_err(|error| error.to_string())?;
    result.map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_generation(
    mut input: GenerationStartRequest,
    on_event: Channel<Value>,
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> Result<GenerationStartResult, String> {
    let is_codex = input
        .request
        .pointer("/provider/kind")
        .and_then(Value::as_str)
        == Some("codex");
    let codex_program = if is_codex {
        if input.credential_ref.is_some() {
            return Err("Codex generation uses the system ChatGPT session, not an API key.".into());
        }
        let discovery = discover_codex();
        if !discovery.status.authenticated {
            return Err(discovery.status.message);
        }
        let program = discovery
            .program
            .ok_or_else(|| "No compatible Codex installation was found.".to_owned())?;
        if !codex_adapter::supports_hardened_exec(&program) {
            return Err(
                "This Codex installation is signed in, but it is too old for safe page generation. Update ChatGPT or Codex and try again."
                    .into(),
            );
        }
        let catalog = codex_adapter::load_catalog(&program)
            .await
            .map_err(|error| error.to_string())?;
        codex_adapter::bind_generation_request(&mut input.request, &catalog)?;
        Some(program)
    } else {
        None
    };

    if let Some(secret_ref) = input.credential_ref.clone() {
        let requested_provider = input.request.get("provider").cloned().ok_or_else(|| {
            "provider configuration is required for a credentialed request".to_owned()
        })?;
        let connection_id = provider_connection_id(&requested_provider)?.to_owned();
        let provider_record =
            bound_provider_record(&runtime, &input.profile_id, &connection_id, &secret_ref)?;
        let provider = provider_for_worker(&provider_record, &requested_provider)?;
        input
            .request
            .as_object_mut()
            .ok_or_else(|| "generation request must be an object".to_owned())?
            .insert("provider".into(), provider);
    }
    let credential = input
        .credential_ref
        .as_deref()
        .map(|secret_ref| runtime.secrets.get(secret_ref))
        .transpose()
        .map_err(|error| error.to_string())?;
    let job_id = runtime
        .worker
        .start_generation(
            app,
            runtime.storage.clone(),
            input,
            credential,
            codex_program,
            on_event,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(GenerationStartResult { job_id })
}

#[tauri::command]
async fn cancel_generation(job_id: String, runtime: State<'_, AppRuntime>) -> Result<(), String> {
    runtime
        .worker
        .cancel(&job_id)
        .await
        .map_err(|error| error.to_string())
}

fn validated_window_corner_radius(radius: f64) -> Result<f64, String> {
    if radius.is_finite() && (0.0..=64.0).contains(&radius) {
        Ok(radius)
    } else {
        Err("window corner radius must be a finite value between 0 and 64".into())
    }
}

#[tauri::command]
fn set_window_corner_radius(window: tauri::WebviewWindow, radius: f64) -> Result<(), String> {
    let radius = validated_window_corner_radius(radius)?;
    #[cfg(target_os = "macos")]
    apply_macos_window_corner_radius(window, radius)?;
    #[cfg(not(target_os = "macos"))]
    let _ = (window, radius);
    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_macos_window_corner_radius(
    window: tauri::WebviewWindow,
    radius: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSColor, NSWindow};
    use objc2_quartz_core::kCACornerCurveContinuous;

    window
        .with_webview(move |webview| unsafe {
            let native_window: &NSWindow = &*webview.ns_window().cast();
            native_window.setOpaque(false);
            let clear = NSColor::clearColor();
            native_window.setBackgroundColor(Some(&clear));
            if let Some(content_view) = native_window.contentView() {
                content_view.setWantsLayer(true);
                if let Some(layer) = content_view.layer() {
                    layer.setCornerRadius(radius);
                    layer.setCornerCurve(kCACornerCurveContinuous);
                    layer.setMasksToBounds(radius > 0.0);
                }
            }
            native_window.invalidateShadow();
        })
        .map_err(|error| format!("could not update the native window shape: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_, _, _| {}));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .on_menu_event(|app, event| emit_native_menu_command(app, event.id().as_ref()))
        .setup(|app| {
            let (menu, native_menu_items) = build_native_menu(app.handle())?;
            app.set_menu(menu)?;
            app.manage(native_menu_items);
            let app_data = app.path().app_data_dir()?;
            let storage = Arc::new(Storage::open(&app_data.join("vibesurfer.sqlite3"))?);
            app.manage(AppRuntime {
                storage,
                secrets: SecretVault,
                worker: WorkerManager::new(),
            });
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if event
                    .urls()
                    .iter()
                    .any(|url| is_supported_deep_link(url.as_str()))
                {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            codex_auth_status,
            codex_model_catalog,
            start_codex_login,
            runtime_status,
            put_provider_secret,
            provider_secret_status,
            delete_provider_secret,
            save_artifact,
            get_artifact,
            get_cached_artifact,
            list_artifacts,
            delete_profile_artifacts,
            upsert_site_world,
            get_site_world,
            list_site_worlds,
            delete_site_world,
            delete_profile_site_worlds,
            archive_profile_site_worlds,
            activate_site_world,
            delete_profile_data,
            upsert_provider_connection,
            list_provider_connections,
            delete_provider_connection,
            verify_provider_connection,
            start_generation,
            cancel_generation,
            set_window_corner_radius,
            update_native_menu_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running vibesurfer");
}

fn is_supported_deep_link(value: &str) -> bool {
    value.len() <= 4_096
        && value == value.trim()
        && !value.chars().any(char::is_control)
        && value.split_once("://").is_some_and(|(scheme, _)| {
            scheme.eq_ignore_ascii_case("vibe") || scheme.eq_ignore_ascii_case("vibes")
        })
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use serde_json::json;

    use super::{
        delete_secret_before_provider_record, discover_codex_with, is_supported_deep_link,
        provider_connection_id, provider_for_worker, validated_window_corner_radius, CodexProbe,
        CodexProbeState, ProviderConnectionRecord,
    };
    use crate::native_menu::native_menu_command;
    use std::path::{Path, PathBuf};

    fn provider_record() -> ProviderConnectionRecord {
        ProviderConnectionRecord {
            id: "openai-main".into(),
            profile_id: "personal".into(),
            kind: "openai".into(),
            display_name: "OpenAI personal".into(),
            base_url: None,
            secret_ref: "personal:openai-main".into(),
            enabled: true,
            status: "valid".into(),
            last_verified_at: None,
            payload: json!({ "modelIds": ["openai:gpt-test"] }),
        }
    }

    #[test]
    fn deep_link_filter_accepts_only_configured_protocols() {
        assert!(is_supported_deep_link("vibe://open"));
        assert!(is_supported_deep_link("vibes://open/path?ignored=true"));
        assert!(is_supported_deep_link("VIBES://open"));
        assert!(!is_supported_deep_link("vibeevil://open"));
        assert!(!is_supported_deep_link("https://example.com"));
        assert!(!is_supported_deep_link(" vibe://open"));
        assert!(!is_supported_deep_link("vibe://open\n"));
        assert!(!is_supported_deep_link(&format!(
            "vibe://{}",
            "x".repeat(4_090)
        )));
    }

    #[test]
    fn native_menu_emits_only_allowlisted_browser_commands() {
        assert_eq!(native_menu_command("new-tab"), Some("new-tab"));
        assert_eq!(native_menu_command("open-models"), Some("open-models"));
        assert_eq!(native_menu_command("quit"), None);
        assert_eq!(native_menu_command("javascript:alert(1)"), None);
    }

    #[test]
    fn native_window_radius_is_bounded() {
        assert_eq!(validated_window_corner_radius(0.0), Ok(0.0));
        assert_eq!(validated_window_corner_radius(28.0), Ok(28.0));
        assert!(validated_window_corner_radius(-1.0).is_err());
        assert!(validated_window_corner_radius(65.0).is_err());
        assert!(validated_window_corner_radius(f64::NAN).is_err());
    }

    #[test]
    fn provider_identity_must_not_be_ambiguous() {
        assert_eq!(
            provider_connection_id(&json!({
                "id": "openai-main",
                "connectionId": "openai-main"
            }))
            .unwrap(),
            "openai-main"
        );
        assert!(provider_connection_id(&json!({
            "id": "openai-main",
            "connectionId": "attacker"
        }))
        .is_err());
    }

    #[test]
    fn worker_provider_uses_persisted_connection_metadata() {
        let provider = provider_for_worker(
            &provider_record(),
            &json!({
                "id": "openai-main",
                "connectionId": "openai-main",
                "kind": "openai-compatible",
                "baseUrl": "https://attacker.invalid/v1",
                "modelId": "gpt-test"
            }),
        )
        .unwrap();
        assert_eq!(provider["kind"], "openai");
        assert!(provider["baseUrl"].is_null());
        assert_eq!(provider["modelId"], "gpt-test");
        assert_eq!(provider["generationMode"], "directed");
        assert!(
            provider_for_worker(&provider_record(), &json!({ "modelId": "not-allowed" })).is_err()
        );
    }

    #[test]
    fn legacy_openai_compatible_provider_defaults_to_compact_generation() {
        let mut record = provider_record();
        record.kind = "openai-compatible".into();
        record.base_url = Some("http://127.0.0.1:8080/v1".into());
        record.payload = json!({ "modelIds": ["openai-compatible:local-model"] });
        let provider = provider_for_worker(
            &record,
            &json!({
                "modelId": "local-model",
                "generationMode": "directed"
            }),
        )
        .unwrap();
        assert_eq!(provider["generationMode"], "compact");
        assert_eq!(provider["supportsStructuredOutputs"], false);
    }

    #[test]
    fn keychain_failure_keeps_provider_record() {
        let provider_deleted = Cell::new(false);
        let result = delete_secret_before_provider_record(
            || Err("keychain unavailable".into()),
            || {
                provider_deleted.set(true);
                Ok(1)
            },
        );
        assert!(result.is_err());
        assert!(!provider_deleted.get());
    }

    #[test]
    fn successful_delete_removes_secret_before_provider_record() {
        let order = RefCell::new(Vec::new());
        delete_secret_before_provider_record(
            || {
                order.borrow_mut().push("secret");
                Ok(())
            },
            || {
                order.borrow_mut().push("provider");
                Ok(1)
            },
        )
        .unwrap();
        assert_eq!(*order.borrow(), ["secret", "provider"]);
    }

    #[test]
    fn codex_discovery_skips_incompatible_cli_for_authenticated_runtime() {
        let discovery = discover_codex_with(
            vec![PathBuf::from("old-codex"), PathBuf::from("chatgpt-codex")],
            |program: &Path| {
                if program == Path::new("old-codex") {
                    CodexProbe {
                        state: CodexProbeState::Unhealthy,
                        message: "unknown variant `ultra`".into(),
                    }
                } else {
                    CodexProbe {
                        state: CodexProbeState::Authenticated,
                        message: "Logged in using ChatGPT".into(),
                    }
                }
            },
        );

        assert!(discovery.status.available);
        assert!(discovery.status.healthy);
        assert!(discovery.status.authenticated);
        assert_eq!(discovery.program, Some(PathBuf::from("chatgpt-codex")));
        assert_eq!(discovery.status.message, "Logged in using ChatGPT");
    }

    #[test]
    fn codex_discovery_prefers_any_authenticated_runtime_over_signed_out_fallback() {
        let discovery = discover_codex_with(
            vec![PathBuf::from("signed-out"), PathBuf::from("signed-in")],
            |program: &Path| CodexProbe {
                state: if program == Path::new("signed-in") {
                    CodexProbeState::Authenticated
                } else {
                    CodexProbeState::SignedOut
                },
                message: if program == Path::new("signed-in") {
                    "Logged in using ChatGPT".into()
                } else {
                    "Not logged in".into()
                },
            },
        );

        assert!(discovery.status.authenticated);
        assert_eq!(discovery.program, Some(PathBuf::from("signed-in")));
    }

    #[test]
    fn codex_discovery_keeps_first_healthy_signed_out_runtime_for_login() {
        let discovery = discover_codex_with(
            vec![PathBuf::from("first"), PathBuf::from("broken")],
            |program: &Path| CodexProbe {
                state: if program == Path::new("first") {
                    CodexProbeState::SignedOut
                } else {
                    CodexProbeState::Unhealthy
                },
                message: if program == Path::new("first") {
                    "Not logged in".into()
                } else {
                    "configuration error".into()
                },
            },
        );

        assert!(discovery.status.available);
        assert!(discovery.status.healthy);
        assert!(!discovery.status.authenticated);
        assert_eq!(discovery.program, Some(PathBuf::from("first")));
    }

    #[test]
    fn codex_discovery_reports_incompatible_runtime_without_enabling_login() {
        let discovery = discover_codex_with(vec![PathBuf::from("broken")], |_| CodexProbe {
            state: CodexProbeState::Unhealthy,
            message: "configuration error".into(),
        });

        assert!(discovery.status.available);
        assert!(!discovery.status.healthy);
        assert!(!discovery.status.authenticated);
        assert!(discovery.program.is_none());
        assert!(discovery.status.message.contains("configuration error"));
    }
}
