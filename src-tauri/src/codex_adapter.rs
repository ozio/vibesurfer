use std::{path::Path, process::Stdio, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum CodexAdapterError {
    #[error("could not start the Codex App Server: {0}")]
    Spawn(String),
    #[error("Codex App Server I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Codex App Server returned an invalid response: {0}")]
    Protocol(String),
    #[error("Codex App Server request timed out")]
    Timeout,
    #[error("ChatGPT is not signed in through this Codex installation")]
    SignedOut,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCatalog {
    pub models: Vec<CodexModel>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    pub id: String,
    pub model: String,
    pub display_name: String,
    pub description: String,
    pub is_default: bool,
    pub default_reasoning_effort: String,
    pub supported_reasoning_efforts: Vec<CodexReasoningEffort>,
    pub default_service_tier: Option<String>,
    pub service_tiers: Vec<CodexServiceTier>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexReasoningEffort {
    pub reasoning_effort: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexServiceTier {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexSelection {
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub service_tier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawModelList {
    #[serde(default)]
    data: Vec<RawModel>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawModel {
    id: String,
    model: String,
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    is_default: bool,
    default_reasoning_effort: String,
    #[serde(default)]
    supported_reasoning_efforts: Vec<CodexReasoningEffort>,
    #[serde(default)]
    default_service_tier: Option<String>,
    #[serde(default)]
    service_tiers: Vec<CodexServiceTier>,
}

impl CodexCatalog {
    pub fn resolve_selection(
        &self,
        requested_model: &str,
        requested_effort: Option<&str>,
        requested_tier: Option<&str>,
    ) -> Result<CodexSelection, String> {
        let alias = matches!(requested_model, "auto" | "chatgpt" | "reasoning");
        let model = if alias {
            self.models
                .iter()
                .find(|model| model.is_default)
                .or_else(|| self.models.first())
        } else {
            self.models
                .iter()
                .find(|model| model.model == requested_model || model.id == requested_model)
        }
        .ok_or_else(|| {
            "The selected Codex model is not available for this ChatGPT account.".to_owned()
        })?;

        let requested_effort = requested_effort
            .filter(|value| !value.is_empty())
            .or_else(|| (requested_model == "reasoning").then_some("high"));
        let reasoning_effort = requested_effort.map(str::to_owned).or_else(|| {
            (!model.default_reasoning_effort.is_empty())
                .then(|| model.default_reasoning_effort.clone())
        });
        if let Some(effort) = reasoning_effort.as_deref() {
            let supported = model
                .supported_reasoning_efforts
                .iter()
                .any(|candidate| candidate.reasoning_effort == effort);
            if !supported {
                return Err(format!(
                    "Reasoning effort '{effort}' is not supported by {}.",
                    model.display_name
                ));
            }
        }

        let service_tier = requested_tier
            .filter(|value| !value.is_empty() && *value != "standard")
            .map(str::to_owned);
        if let Some(tier) = service_tier.as_deref() {
            let supported = model
                .service_tiers
                .iter()
                .any(|candidate| candidate.id == tier);
            if !supported {
                return Err(format!(
                    "Speed tier '{tier}' is not supported by {}.",
                    model.display_name
                ));
            }
        }

        Ok(CodexSelection {
            model: model.model.clone(),
            reasoning_effort,
            service_tier,
        })
    }
}

pub fn supports_hardened_exec(program: &Path) -> bool {
    let output = std::process::Command::new(program)
        .args(["exec", "--help"])
        .output();
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    hardened_exec_help_supported(&String::from_utf8_lossy(&output.stdout))
}

fn hardened_exec_help_supported(help: &str) -> bool {
    [
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--output-schema",
        "--json",
    ]
    .iter()
    .all(|flag| help.contains(flag))
}

pub fn bind_generation_request(
    request: &mut Value,
    catalog: &CodexCatalog,
) -> Result<CodexSelection, String> {
    let request_object = request
        .as_object_mut()
        .ok_or_else(|| "generation request must be an object".to_owned())?;
    let provider = request_object
        .get("provider")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex provider configuration is required".to_owned())?;
    if provider.get("kind").and_then(Value::as_str) != Some("codex") {
        return Err("Codex generation requires the Codex provider.".into());
    }
    if [
        "apiKey",
        "credential",
        "credentials",
        "headers",
        "baseUrl",
        "baseURL",
    ]
    .iter()
    .any(|key| provider.get(*key).is_some_and(|value| !value.is_null()))
    {
        return Err(
            "Codex generation cannot accept inline credentials or a custom endpoint.".into(),
        );
    }

    let requested_model = provider
        .get("modelId")
        .and_then(Value::as_str)
        .or_else(|| request_object.get("modelId").and_then(Value::as_str))
        .unwrap_or("chatgpt");
    let requested_effort = provider
        .get("reasoningEffort")
        .and_then(Value::as_str)
        .or_else(|| {
            request_object
                .get("reasoningEffort")
                .and_then(Value::as_str)
        });
    let requested_tier = provider
        .get("serviceTier")
        .and_then(Value::as_str)
        .or_else(|| request_object.get("serviceTier").and_then(Value::as_str));
    let selection = catalog.resolve_selection(requested_model, requested_effort, requested_tier)?;

    request_object.insert(
        "provider".into(),
        json!({
            "id": "codex",
            "connectionId": "codex",
            "kind": "codex",
            "displayName": "Codex (ChatGPT)",
            "modelId": selection.model,
            "reasoningEffort": selection.reasoning_effort,
            "serviceTier": selection.service_tier,
        }),
    );
    request_object.insert("modelId".into(), Value::String(selection.model.clone()));
    Ok(selection)
}

pub async fn load_catalog(program: &Path) -> Result<CodexCatalog, CodexAdapterError> {
    let mut child = spawn_app_server(program)?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| CodexAdapterError::Spawn("stdin is unavailable".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CodexAdapterError::Spawn("stdout is unavailable".into()))?;
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while matches!(lines.next_line().await, Ok(Some(_))) {}
        });
    }
    let mut lines = BufReader::new(stdout).lines();

    let result = async {
        send_request(
            &mut stdin,
            1,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "vibesurfer",
                    "title": "vibesurfer",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
        )
        .await?;
        read_response(&mut lines, &mut stdin, 1).await?;
        send_notification(&mut stdin, "initialized", json!({})).await?;

        send_request(
            &mut stdin,
            2,
            "account/read",
            json!({ "refreshToken": false }),
        )
        .await?;
        let account = read_response(&mut lines, &mut stdin, 2).await?;
        if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt") {
            return Err(CodexAdapterError::SignedOut);
        }

        send_request(
            &mut stdin,
            3,
            "model/list",
            json!({ "limit": 100, "includeHidden": false }),
        )
        .await?;
        let models = read_response(&mut lines, &mut stdin, 3).await?;
        normalize_catalog(models)
    };

    let outcome = tokio::time::timeout(REQUEST_TIMEOUT, result)
        .await
        .map_err(|_| CodexAdapterError::Timeout)?;
    let _ = child.kill().await;
    outcome
}

fn spawn_app_server(program: &Path) -> Result<Child, CodexAdapterError> {
    let mut command = Command::new(program);
    command.args(["app-server", "--stdio"]);
    if let Some(home) = system_codex_home() {
        command.env("CODEX_HOME", home);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| CodexAdapterError::Spawn(error.to_string()))
}

fn system_codex_home() -> Option<std::path::PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".codex"))
        })
}

async fn send_request(
    stdin: &mut ChildStdin,
    id: u64,
    method: &str,
    params: Value,
) -> Result<(), CodexAdapterError> {
    send(
        stdin,
        &json!({ "id": id, "method": method, "params": params }),
    )
    .await
}

async fn send_notification(
    stdin: &mut ChildStdin,
    method: &str,
    params: Value,
) -> Result<(), CodexAdapterError> {
    send(stdin, &json!({ "method": method, "params": params })).await
}

async fn send(stdin: &mut ChildStdin, value: &Value) -> Result<(), CodexAdapterError> {
    let mut line = serde_json::to_vec(value)
        .map_err(|error| CodexAdapterError::Protocol(error.to_string()))?;
    line.push(b'\n');
    stdin.write_all(&line).await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_response<R: tokio::io::AsyncBufRead + Unpin>(
    lines: &mut tokio::io::Lines<R>,
    stdin: &mut ChildStdin,
    expected_id: u64,
) -> Result<Value, CodexAdapterError> {
    while let Some(line) = lines.next_line().await? {
        if line.len() > MAX_LINE_BYTES {
            return Err(CodexAdapterError::Protocol(
                "response exceeded the size limit".into(),
            ));
        }
        let message: Value = serde_json::from_str(&line)
            .map_err(|_| CodexAdapterError::Protocol("non-JSON output".into()))?;
        if message.get("id").is_some() && message.get("method").is_some() {
            let response = json!({
                "id": message.get("id"),
                "error": { "code": -32601, "message": "Unsupported server request" }
            });
            send(stdin, &response).await?;
            continue;
        }
        if message.get("id").and_then(Value::as_u64) == Some(expected_id) {
            if message.get("error").is_some() {
                return Err(CodexAdapterError::Protocol(
                    "the requested operation was rejected".into(),
                ));
            }
            return message
                .get("result")
                .cloned()
                .ok_or_else(|| CodexAdapterError::Protocol("response has no result".into()));
        }
    }
    Err(CodexAdapterError::Protocol(
        "server exited before replying".into(),
    ))
}

fn normalize_catalog(value: Value) -> Result<CodexCatalog, CodexAdapterError> {
    let raw: RawModelList = serde_json::from_value(value)
        .map_err(|_| CodexAdapterError::Protocol("invalid model catalog".into()))?;
    let models = raw
        .data
        .into_iter()
        .filter(|model| !model.hidden && !model.id.is_empty() && !model.model.is_empty())
        .map(|model| CodexModel {
            id: model.id,
            model: model.model,
            display_name: model.display_name,
            description: model.description,
            is_default: model.is_default,
            default_reasoning_effort: model.default_reasoning_effort,
            supported_reasoning_efforts: model.supported_reasoning_efforts,
            default_service_tier: model.default_service_tier,
            service_tiers: model.service_tiers,
        })
        .collect::<Vec<_>>();
    if models.is_empty() {
        return Err(CodexAdapterError::Protocol("model catalog is empty".into()));
    }
    Ok(CodexCatalog { models })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> CodexCatalog {
        normalize_catalog(json!({
            "data": [
                {
                    "id": "gpt-default",
                    "model": "gpt-default",
                    "displayName": "GPT Default",
                    "description": "Default model",
                    "hidden": false,
                    "isDefault": true,
                    "defaultReasoningEffort": "medium",
                    "supportedReasoningEfforts": [
                        { "reasoningEffort": "low", "description": "Faster" },
                        { "reasoningEffort": "medium", "description": "Balanced" },
                        { "reasoningEffort": "high", "description": "Deeper" }
                    ],
                    "defaultServiceTier": null,
                    "serviceTiers": [
                        { "id": "priority", "name": "Fast", "description": "Faster responses" }
                    ]
                }
            ]
        }))
        .unwrap()
    }

    #[test]
    fn resolves_default_model_with_supported_controls() {
        assert_eq!(
            catalog()
                .resolve_selection("chatgpt", Some("high"), Some("priority"))
                .unwrap(),
            CodexSelection {
                model: "gpt-default".into(),
                reasoning_effort: Some("high".into()),
                service_tier: Some("priority".into()),
            }
        );
    }

    #[test]
    fn rejects_controls_not_advertised_by_model() {
        assert!(catalog()
            .resolve_selection("gpt-default", Some("ultra"), None)
            .unwrap_err()
            .contains("not supported"));
        assert!(catalog()
            .resolve_selection("gpt-default", None, Some("turbo"))
            .unwrap_err()
            .contains("not supported"));
    }

    #[test]
    fn canonicalizes_renderer_request_without_credentials_or_paths() {
        let mut request = json!({
            "provider": {
                "id": "renderer-controlled",
                "kind": "codex",
                "modelId": "gpt-default",
                "reasoningEffort": "low",
                "serviceTier": "standard"
            }
        });
        let selected = bind_generation_request(&mut request, &catalog()).unwrap();
        assert_eq!(selected.model, "gpt-default");
        assert_eq!(selected.service_tier, None);
        assert_eq!(request["provider"]["id"], "codex");
        assert_eq!(request["provider"]["modelId"], "gpt-default");
        assert!(request["provider"].get("executablePath").is_none());
    }

    #[test]
    fn rejects_renderer_supplied_codex_credentials_and_endpoints() {
        for forbidden in [
            json!({ "apiKey": "secret" }),
            json!({ "baseUrl": "https://example.test" }),
            json!({ "headers": { "Authorization": "secret" } }),
        ] {
            let mut provider = json!({ "kind": "codex", "modelId": "gpt-default" });
            provider
                .as_object_mut()
                .unwrap()
                .extend(forbidden.as_object().unwrap().clone());
            let mut request = json!({ "provider": provider });
            assert!(bind_generation_request(&mut request, &catalog()).is_err());
        }
    }

    #[test]
    fn hardened_exec_requires_every_isolation_flag() {
        let help = "--ignore-user-config --ignore-rules --ephemeral --output-schema --json";
        assert!(hardened_exec_help_supported(help));
        assert!(!hardened_exec_help_supported(
            "--ignore-user-config --ignore-rules --ephemeral --json"
        ));
    }
}
