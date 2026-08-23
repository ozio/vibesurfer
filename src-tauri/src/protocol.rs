use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

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

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummary {
    pub id: String,
    pub profile_id: String,
    pub site_id: String,
    pub url: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummaryPage {
    pub items: Vec<ArtifactSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowsingHistoryRecord {
    pub id: String,
    pub profile_id: String,
    pub url: String,
    pub title: String,
    pub status: String,
    pub opened_at: String,
    pub updated_at: String,
    pub favicon: Option<Value>,
    pub artifact_id: Option<String>,
    pub generation_job_id: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowsingHistoryPage {
    pub items: Vec<BrowsingHistoryRecord>,
    pub next_cursor: Option<String>,
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
pub struct SiteSessionRecord {
    pub profile_id: String,
    pub site_world_id: String,
    pub revision: i64,
    pub updated_at: String,
    pub payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSessionActionRequest {
    pub profile_id: String,
    pub site_world_id: String,
    pub action: String,
    #[serde(default)]
    pub fields: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteRegionPatch {
    pub region_id: String,
    pub html: String,
    pub revision: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSessionPatchRequest {
    pub profile_id: String,
    pub site_world_id: String,
    pub canonical_page_url: String,
    pub patches: Vec<SiteRegionPatch>,
    #[serde(default)]
    pub update_model_state: bool,
    #[serde(default)]
    pub model_state: Value,
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

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaVoiceRecord {
    pub id: String,
    pub name: String,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaConnectionRecord {
    pub id: String,
    pub profile_id: String,
    pub provider: String,
    pub display_name: String,
    pub secret_ref: String,
    pub status: String,
    pub last_verified_at: Option<String>,
    pub voices: Vec<MediaVoiceRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub protocol_version: u32,
    pub worker_available: bool,
    pub worker_description: String,
    pub active_jobs: usize,
    pub idle_workers: usize,
    pub spawned_workers: u64,
    pub reused_workers: u64,
    pub spawned_media_workers: u64,
    pub reused_media_workers: u64,
    pub storage_ready: bool,
    pub storage_queue_depth: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJobRecord {
    pub id: String,
    pub profile_id: String,
    pub status: String,
    pub request_payload: Value,
    pub result_artifact_id: Option<String>,
    pub error_payload: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJobPage {
    pub items: Vec<GenerationJobRecord>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJobEventRecord {
    pub id: i64,
    pub job_id: String,
    pub event_type: String,
    pub sequence: Option<i64>,
    pub timestamp: String,
    pub payload: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStageRecord {
    pub job_id: String,
    pub stage: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationActivityDetail {
    pub job: GenerationJobRecord,
    pub events: Vec<GenerationJobEventRecord>,
    pub stages: Vec<GenerationStageRecord>,
}
