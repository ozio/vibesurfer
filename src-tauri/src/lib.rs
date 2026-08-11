mod protocol;
mod secrets;
mod storage;
mod worker;

use std::{process::Command, sync::Arc};

use protocol::{
    ArtifactRecord, GenerationStartRequest, GenerationStartResult, ProviderConnectionRecord,
    ProviderVerifyRequest, RuntimeStatus, SiteWorldRecord, WORKER_PROTOCOL_VERSION,
};
use secrets::SecretVault;
use serde::Serialize;
use serde_json::{json, Value};
use storage::Storage;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use worker::WorkerManager;
use zeroize::Zeroizing;

struct AppRuntime {
    storage: Arc<Storage>,
    secrets: SecretVault,
    worker: WorkerManager,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAuthStatus {
    available: bool,
    healthy: bool,
    authenticated: bool,
    message: String,
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
    Ok(json!({
        "id": provider.id,
        "connectionId": provider.id,
        "kind": provider.kind,
        "displayName": provider.display_name,
        "baseUrl": provider.base_url,
        "modelId": requested_model,
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

#[tauri::command]
fn codex_auth_status() -> CodexAuthStatus {
    match Command::new("codex").args(["login", "status"]).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            let message = if stdout.is_empty() { stderr } else { stdout };
            let healthy =
                output.status.success() || message.to_lowercase().contains("not logged in");

            CodexAuthStatus {
                available: true,
                healthy,
                authenticated: output.status.success(),
                message,
            }
        }
        Err(error) => CodexAuthStatus {
            available: false,
            healthy: false,
            authenticated: false,
            message: format!("Codex CLI is unavailable: {error}"),
        },
    }
}

#[tauri::command]
fn start_codex_login() -> Result<(), String> {
    Command::new("codex")
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
        .start_generation(app, runtime.storage.clone(), input, credential, on_event)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let storage = Arc::new(Storage::open(&app_data.join("vibesurfer.sqlite3"))?);
            app.manage(AppRuntime {
                storage,
                secrets: SecretVault,
                worker: WorkerManager::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            codex_auth_status,
            start_codex_login,
            runtime_status,
            put_provider_secret,
            provider_secret_status,
            delete_provider_secret,
            save_artifact,
            get_artifact,
            list_artifacts,
            delete_profile_artifacts,
            upsert_site_world,
            get_site_world,
            list_site_worlds,
            delete_site_world,
            delete_profile_site_worlds,
            upsert_provider_connection,
            list_provider_connections,
            delete_provider_connection,
            verify_provider_connection,
            start_generation,
            cancel_generation
        ])
        .run(tauri::generate_context!())
        .expect("error while running VibeSurfer");
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use serde_json::json;

    use super::{
        delete_secret_before_provider_record, provider_connection_id, provider_for_worker,
        ProviderConnectionRecord,
    };

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
        assert!(
            provider_for_worker(&provider_record(), &json!({ "modelId": "not-allowed" })).is_err()
        );
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
}
