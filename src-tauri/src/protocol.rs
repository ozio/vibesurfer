use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WORKER_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStartRequest {
    pub job_id: Option<String>,
    pub profile_id: String,
    pub credential_ref: Option<String>,
    pub request: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStartResult {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderVerifyRequest {
    pub profile_id: String,
    pub credential_ref: String,
    pub provider: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub id: String,
    pub profile_id: String,
    pub site_id: String,
    pub url: String,
    pub title: String,
    pub html: String,
    pub created_at: String,
    pub payload: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteWorldRecord {
    pub id: String,
    pub profile_id: String,
    pub origin: String,
    pub state: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionRecord {
    pub id: String,
    pub profile_id: String,
    pub kind: String,
    pub display_name: String,
    pub base_url: Option<String>,
    pub secret_ref: String,
    pub enabled: bool,
    pub status: String,
    pub last_verified_at: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub protocol_version: u32,
    pub worker_available: bool,
    pub worker_description: String,
    pub active_jobs: usize,
    pub storage_ready: bool,
}
