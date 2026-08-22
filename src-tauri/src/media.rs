use std::{
    collections::HashMap,
    fs,
    future::Future,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::watch;
use tauri::AppHandle;
use uuid::Uuid;

use crate::{media_worker, protocol::MediaVoiceRecord};

const MEDIA_CACHE_SCHEMA: u32 = 1;
const MEDIA_CACHE_LIMIT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MEDIA_ASSET_BYTES: usize = 128 * 1024 * 1024;
const ELEVENLABS_ORIGIN: &str = "https://api.elevenlabs.io";
const KOKORO_RUNTIME_SCHEMA: &str = "kokoro-82m-q8-v1";
const KOKORO_ASSETS: &[&str] = &[
    "models/onnx-community/Kokoro-82M-v1.0-ONNX/config.json",
    "models/onnx-community/Kokoro-82M-v1.0-ONNX/tokenizer.json",
    "models/onnx-community/Kokoro-82M-v1.0-ONNX/tokenizer_config.json",
    "models/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx",
    "models/onnx-community/Kokoro-82M-v1.0-ONNX/voices/af_heart.bin",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSpeechRequest {
    pub request_id: String,
    pub profile_id: String,
    pub engine: String,
    pub connection_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub voice: String,
    pub speed: f64,
    pub text: String,
    pub lang: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMusicRequest {
    pub request_id: String,
    pub profile_id: String,
    pub connection_id: String,
    pub prompt: String,
    pub duration_ms: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSpeechCacheRequest {
    pub profile_id: String,
    pub model: String,
    pub voice: String,
    pub speed: f64,
    pub text: String,
    pub lang: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreLocalSpeechCacheRequest {
    #[serde(flatten)]
    pub speech: LocalSpeechCacheRequest,
    pub mime_type: String,
    pub data_base64: String,
    pub duration_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMediaConnectionInput {
    pub id: String,
    pub profile_id: String,
    pub display_name: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionWord {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAssetResponse {
    pub mime_type: String,
    pub data_base64: String,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub caption_words: Vec<CaptionWord>,
    pub cache_hit: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedMediaMetadata {
    schema: u32,
    mime_type: String,
    duration_ms: u64,
    caption_words: Vec<CaptionWord>,
    byte_size: u64,
    last_accessed_at: String,
}

#[derive(Debug, Deserialize)]
struct ElevenVoicesResponse {
    voices: Vec<ElevenVoice>,
}

#[derive(Debug, Deserialize)]
struct ElevenVoice {
    voice_id: String,
    name: String,
    category: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ElevenSpeechResponse {
    audio_base64: String,
    alignment: Option<ElevenAlignment>,
    normalized_alignment: Option<ElevenAlignment>,
}

#[derive(Debug, Deserialize)]
struct ElevenAlignment {
    characters: Vec<String>,
    character_start_times_seconds: Vec<f64>,
    character_end_times_seconds: Vec<f64>,
}

pub struct MediaService {
    cache_root: PathBuf,
    cache_limit_bytes: u64,
    origin: String,
    client: Client,
    cancellations: Mutex<HashMap<String, watch::Sender<bool>>>,
    runtime_assets: Mutex<()>,
}

impl MediaService {
    pub fn new(cache_root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&cache_root).map_err(|error| format!("could not create media cache: {error}"))?;
        let client = Client::builder()
            .user_agent("VibeSurfer/0.1 media-host")
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| format!("could not initialize media client: {error}"))?;
        Ok(Self {
            cache_root,
            cache_limit_bytes: MEDIA_CACHE_LIMIT_BYTES,
            origin: ELEVENLABS_ORIGIN.into(),
            client,
            cancellations: Mutex::new(HashMap::new()),
            runtime_assets: Mutex::new(()),
        })
    }

    pub fn cancel(&self, request_id: &str) -> Result<(), String> {
        validate_identifier(request_id)?;
        if let Some(sender) = self.cancellations.lock().map_err(|_| "media request registry is unavailable")?.remove(request_id) {
            let _ = sender.send(true);
        }
        Ok(())
    }

    pub fn delete_profile_cache(&self, profile_id: &str) -> Result<(), String> {
        let directory = self.profile_directory(profile_id)?;
        if directory.exists() {
            fs::remove_dir_all(&directory).map_err(|error| format!("could not remove media cache: {error}"))?;
        }
        Ok(())
    }

    pub fn cached_local_speech(&self, request: &LocalSpeechCacheRequest) -> Result<Option<MediaAssetResponse>, String> {
        validate_local_speech_cache_request(request)?;
        self.cache_get(&request.profile_id, &local_speech_cache_key(request))
    }

    pub fn store_local_speech(&self, request: &StoreLocalSpeechCacheRequest) -> Result<MediaAssetResponse, String> {
        validate_local_speech_cache_request(&request.speech)?;
        if request.mime_type != "audio/wav" || request.data_base64.len() > MAX_MEDIA_ASSET_BYTES.saturating_mul(2) {
            return Err("local speech cache asset is invalid".into());
        }
        let bytes = BASE64.decode(request.data_base64.as_bytes())
            .map_err(|_| "local speech cache audio is not valid base64".to_owned())?;
        self.cache_put(
            &request.speech.profile_id,
            &local_speech_cache_key(&request.speech),
            &request.mime_type,
            request.duration_ms,
            Vec::new(),
            bytes,
        )
    }

    pub async fn render_kokoro_speech(&self, app: &AppHandle, request: &MediaSpeechRequest) -> Result<MediaAssetResponse, String> {
        validate_kokoro_speech_request(request)?;
        let cache_request = LocalSpeechCacheRequest {
            profile_id: request.profile_id.clone(),
            model: request.model.clone(),
            voice: request.voice.clone(),
            speed: request.speed,
            text: request.text.clone(),
            lang: request.lang.clone(),
        };
        let cache_key = local_speech_cache_key(&cache_request);
        if let Some(asset) = self.cache_get(&request.profile_id, &cache_key)? { return Ok(asset); }

        let model_root = self.ensure_kokoro_assets(app)?;
        let worker = media_worker::discover(app)?;
        let payload = json!({
            "text": request.text,
            "voice": request.voice,
            "speed": request.speed,
        });
        let bytes = self.run_cancellable(
            &request.request_id,
            Duration::from_secs(120),
            media_worker::render(&worker, &model_root, &payload),
        ).await?;
        let duration_ms = wav_duration_ms(&bytes).ok_or_else(|| "Kokoro returned audio with no readable duration".to_owned())?;
        self.cache_put(&request.profile_id, &cache_key, "audio/wav", duration_ms, Vec::new(), bytes)
    }

    pub async fn verify_elevenlabs(&self, api_key: &str) -> Result<Vec<MediaVoiceRecord>, String> {
        let response = tokio::time::timeout(
            Duration::from_secs(25),
            self.client
                .get(format!("{}/v2/voices", self.origin))
                .query(&[("page_size", "100"), ("include_total_count", "false")])
                .header("xi-api-key", api_key)
                .send(),
        ).await.map_err(|_| "ElevenLabs voice verification timed out".to_owned())?
            .map_err(|error| format!("ElevenLabs voice verification failed: {error}"))?;
        let response = checked_response(response, "ElevenLabs voice verification").await?;
        let payload: ElevenVoicesResponse = response.json().await
            .map_err(|error| format!("ElevenLabs returned an invalid voice catalog: {error}"))?;
        let mut voices = payload.voices.into_iter().filter_map(|voice| {
            if !valid_remote_id(&voice.voice_id) || voice.name.trim().is_empty() { return None; }
            Some(MediaVoiceRecord {
                id: voice.voice_id,
                name: voice.name.trim().chars().take(120).collect(),
                category: voice.category.map(|value| value.chars().take(80).collect()),
            })
        }).collect::<Vec<_>>();
        voices.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        voices.truncate(100);
        if voices.is_empty() { return Err("ElevenLabs returned no usable voices".into()); }
        Ok(voices)
    }

    pub async fn render_system_speech(&self, request: &MediaSpeechRequest) -> Result<MediaAssetResponse, String> {
        validate_speech_request(request, false)?;
        let cache_key = media_cache_key(&json!({
            "schema": MEDIA_CACHE_SCHEMA,
            "kind": "speech",
            "provider": "macos-system",
            "model": request.model,
            "voice": request.voice,
            "speed": request.speed,
            "text": request.text,
            "lang": request.lang,
        }));
        if let Some(asset) = self.cache_get(&request.profile_id, &cache_key)? { return Ok(asset); }

        #[cfg(not(target_os = "macos"))]
        {
            return Err("System speech export is not available on this platform".into());
        }
        #[cfg(target_os = "macos")]
        {
            let profile_directory = self.profile_directory(&request.profile_id)?;
            fs::create_dir_all(&profile_directory).map_err(|error| format!("could not prepare media cache: {error}"))?;
            let output_path = profile_directory.join(format!(".speech-{}.aiff", Uuid::new_v4()));
            let words_per_minute = (175.0 * request.speed).round().clamp(105.0, 263.0) as u32;
            let mut command = tokio::process::Command::new("/usr/bin/say");
            command.kill_on_drop(true)
                .arg("-r").arg(words_per_minute.to_string())
                .arg("-o").arg(&output_path);
            if !request.voice.trim().is_empty() { command.arg("-v").arg(request.voice.trim()); }
            command.arg("--").arg(&request.text);
            let result = self.run_cancellable(&request.request_id, Duration::from_secs(90), async move {
                let output = command.output().await.map_err(|error| format!("system speech could not start: {error}"))?;
                if !output.status.success() {
                    let message = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("system speech failed: {}", bounded_error(&message)));
                }
                Ok(())
            }).await;
            if let Err(error) = result {
                let _ = fs::remove_file(&output_path);
                return Err(error);
            }
            let bytes = fs::read(&output_path).map_err(|error| format!("could not read rendered system speech: {error}"));
            let _ = fs::remove_file(&output_path);
            let bytes = bytes?;
            let duration_ms = aiff_duration_ms(&bytes).ok_or_else(|| "system speech returned audio with no readable duration".to_owned())?;
            self.cache_put(&request.profile_id, &cache_key, "audio/aiff", duration_ms, Vec::new(), bytes)
        }
    }

    pub async fn render_elevenlabs_speech(&self, request: &MediaSpeechRequest, api_key: &str) -> Result<MediaAssetResponse, String> {
        validate_speech_request(request, true)?;
        let model = if request.model.trim().is_empty() { "eleven_multilingual_v2" } else { request.model.trim() };
        let cache_key = media_cache_key(&json!({
            "schema": MEDIA_CACHE_SCHEMA,
            "kind": "speech",
            "provider": "elevenlabs",
            "model": model,
            "voice": request.voice,
            "speed": request.speed,
            "text": request.text,
            "lang": request.lang,
        }));
        if let Some(asset) = self.cache_get(&request.profile_id, &cache_key)? { return Ok(asset); }
        let voice = request.voice.trim();
        let mut body = json!({
            "text": request.text,
            "model_id": model,
            "voice_settings": { "speed": request.speed.clamp(0.7, 1.2) },
        });
        if let Some(language) = language_code(&request.lang) {
            body.as_object_mut().expect("media request is an object").insert("language_code".into(), Value::String(language));
        }
        let future = async {
            let response = self.client
                .post(format!("{}/v1/text-to-speech/{voice}/with-timestamps", self.origin))
                .query(&[("output_format", "mp3_44100_128")])
                .header("xi-api-key", api_key)
                .json(&body)
                .send().await
                .map_err(|error| format!("ElevenLabs speech request failed: {error}"))?;
            let response = checked_response(response, "ElevenLabs speech").await?;
            response.json::<ElevenSpeechResponse>().await
                .map_err(|error| format!("ElevenLabs returned an invalid speech response: {error}"))
        };
        let payload = self.run_cancellable(&request.request_id, Duration::from_secs(120), future).await?;
        let bytes = BASE64.decode(payload.audio_base64.as_bytes())
            .map_err(|_| "ElevenLabs returned invalid speech audio".to_owned())?;
        let alignment = payload.normalized_alignment.or(payload.alignment)
            .ok_or_else(|| "ElevenLabs returned speech without timing alignment".to_owned())?;
        let caption_words = caption_words(&alignment);
        let duration_ms = alignment.character_end_times_seconds.iter().copied()
            .filter(|value| value.is_finite() && *value > 0.0)
            .fold(0.0_f64, f64::max);
        if duration_ms <= 0.0 { return Err("ElevenLabs returned an empty speech timeline".into()); }
        self.cache_put(&request.profile_id, &cache_key, "audio/mpeg", (duration_ms * 1_000.0).round() as u64, caption_words, bytes)
    }

    pub async fn generate_elevenlabs_music(&self, request: &MediaMusicRequest, api_key: &str) -> Result<MediaAssetResponse, String> {
        validate_music_request(request)?;
        let duration_ms = request.duration_ms.clamp(3_000, 600_000);
        let cache_key = media_cache_key(&json!({
            "schema": MEDIA_CACHE_SCHEMA,
            "kind": "music",
            "provider": "elevenlabs",
            "model": "music_v1",
            "intent": request.prompt,
            "durationMs": duration_ms,
        }));
        if let Some(asset) = self.cache_get(&request.profile_id, &cache_key)? { return Ok(asset); }
        let body = json!({
            "prompt": format!("Instrumental background score without vocals. {}", request.prompt.trim()),
            "music_length_ms": duration_ms,
            "model_id": "music_v1",
            "force_instrumental": true,
        });
        let future = async {
            let response = self.client
                .post(format!("{}/v1/music", self.origin))
                .query(&[("output_format", "mp3_44100_128")])
                .header("xi-api-key", api_key)
                .json(&body)
                .send().await
                .map_err(|error| format!("ElevenLabs music request failed: {error}"))?;
            let response = checked_response(response, "ElevenLabs music").await?;
            response.bytes().await.map(|bytes| bytes.to_vec())
                .map_err(|error| format!("could not read generated music: {error}"))
        };
        let bytes = self.run_cancellable(&request.request_id, Duration::from_secs(300), future).await?;
        self.cache_put(&request.profile_id, &cache_key, "audio/mpeg", duration_ms, Vec::new(), bytes)
    }

    async fn run_cancellable<T>(
        &self,
        request_id: &str,
        timeout: Duration,
        future: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        validate_identifier(request_id)?;
        let (sender, mut receiver) = watch::channel(false);
        {
            let mut requests = self.cancellations.lock().map_err(|_| "media request registry is unavailable")?;
            if requests.insert(request_id.to_owned(), sender).is_some() {
                return Err("duplicate media request identifier".into());
            }
        }
        let selected = tokio::time::timeout(timeout, async {
            tokio::select! {
                result = future => result,
                _ = receiver.changed() => Err("media request was cancelled".into()),
            }
        }).await;
        self.cancellations.lock().map_err(|_| "media request registry is unavailable")?.remove(request_id);
        selected.map_err(|_| "media request timed out".to_owned())?
    }

    fn profile_directory(&self, profile_id: &str) -> Result<PathBuf, String> {
        validate_identifier(profile_id)?;
        Ok(self.cache_root.join(profile_id))
    }

    fn ensure_kokoro_assets(&self, app: &AppHandle) -> Result<PathBuf, String> {
        let _guard = self.runtime_assets.lock().map_err(|_| "local speech asset lock is unavailable")?;
        let runtime_root = self.cache_root.join(".runtime").join(KOKORO_RUNTIME_SCHEMA);
        for path in KOKORO_ASSETS {
            let target = runtime_root.join(path);
            if target.is_file() { continue; }
            let asset = app.asset_resolver().get((*path).to_owned())
                .ok_or_else(|| format!("packaged local speech asset is unavailable: {path}"))?;
            let parent = target.parent().ok_or_else(|| "invalid local speech asset path".to_owned())?;
            fs::create_dir_all(parent).map_err(|error| format!("could not prepare local speech assets: {error}"))?;
            let temporary = parent.join(format!(".{}.{}", target.file_name().and_then(|value| value.to_str()).unwrap_or("asset"), Uuid::new_v4()));
            fs::write(&temporary, asset.bytes()).map_err(|error| format!("could not extract local speech asset: {error}"))?;
            fs::rename(&temporary, &target).map_err(|error| format!("could not commit local speech asset: {error}"))?;
        }
        Ok(runtime_root.join("models"))
    }

    fn cache_get(&self, profile_id: &str, key: &str) -> Result<Option<MediaAssetResponse>, String> {
        let directory = self.profile_directory(profile_id)?;
        let metadata_path = directory.join(format!("{key}.json"));
        let audio_path = directory.join(format!("{key}.audio"));
        if !metadata_path.is_file() || !audio_path.is_file() { return Ok(None); }
        let mut metadata: CachedMediaMetadata = serde_json::from_slice(&fs::read(&metadata_path)
            .map_err(|error| format!("could not read media cache metadata: {error}"))?)
            .map_err(|error| format!("media cache metadata is invalid: {error}"))?;
        if metadata.schema != MEDIA_CACHE_SCHEMA { return Ok(None); }
        let bytes = fs::read(&audio_path).map_err(|error| format!("could not read media cache asset: {error}"))?;
        if bytes.len() as u64 != metadata.byte_size || bytes.is_empty() { return Ok(None); }
        metadata.last_accessed_at = Utc::now().to_rfc3339();
        let _ = fs::write(&metadata_path, serde_json::to_vec(&metadata).unwrap_or_default());
        Ok(Some(asset_response(metadata.mime_type, metadata.duration_ms, metadata.caption_words, bytes, true)))
    }

    fn cache_put(
        &self,
        profile_id: &str,
        key: &str,
        mime_type: &str,
        duration_ms: u64,
        caption_words: Vec<CaptionWord>,
        bytes: Vec<u8>,
    ) -> Result<MediaAssetResponse, String> {
        if bytes.is_empty() || bytes.len() > MAX_MEDIA_ASSET_BYTES || duration_ms == 0 || duration_ms > 600_000 {
            return Err("media provider returned an invalid or oversized asset".into());
        }
        let directory = self.profile_directory(profile_id)?;
        fs::create_dir_all(&directory).map_err(|error| format!("could not prepare media cache: {error}"))?;
        let audio_path = directory.join(format!("{key}.audio"));
        let metadata_path = directory.join(format!("{key}.json"));
        let temporary_audio = directory.join(format!(".{key}-{}.audio", Uuid::new_v4()));
        let temporary_metadata = directory.join(format!(".{key}-{}.json", Uuid::new_v4()));
        let metadata = CachedMediaMetadata {
            schema: MEDIA_CACHE_SCHEMA,
            mime_type: mime_type.to_owned(),
            duration_ms,
            caption_words: caption_words.clone(),
            byte_size: bytes.len() as u64,
            last_accessed_at: Utc::now().to_rfc3339(),
        };
        fs::write(&temporary_audio, &bytes).map_err(|error| format!("could not cache media asset: {error}"))?;
        fs::write(&temporary_metadata, serde_json::to_vec(&metadata).map_err(|error| error.to_string())?)
            .map_err(|error| format!("could not cache media metadata: {error}"))?;
        fs::rename(&temporary_audio, &audio_path).map_err(|error| format!("could not commit media asset: {error}"))?;
        fs::rename(&temporary_metadata, &metadata_path).map_err(|error| format!("could not commit media metadata: {error}"))?;
        self.enforce_lru(&directory)?;
        Ok(asset_response(mime_type.to_owned(), duration_ms, caption_words, bytes, false))
    }

    fn enforce_lru(&self, directory: &Path) -> Result<(), String> {
        let mut entries = Vec::new();
        let mut total = 0_u64;
        for entry in fs::read_dir(directory).map_err(|error| format!("could not inspect media cache: {error}"))? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") || path.file_name().and_then(|value| value.to_str()).is_some_and(|name| name.starts_with('.')) { continue; }
            let Ok(metadata_bytes) = fs::read(&path) else { continue; };
            let Ok(metadata) = serde_json::from_slice::<CachedMediaMetadata>(&metadata_bytes) else { continue; };
            let Some(stem) = path.file_stem().and_then(|value| value.to_str()).map(str::to_owned) else { continue; };
            total = total.saturating_add(metadata.byte_size);
            entries.push((metadata.last_accessed_at, metadata.byte_size, path, directory.join(format!("{stem}.audio"))));
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        for (_, size, metadata_path, audio_path) in entries {
            if total <= self.cache_limit_bytes { break; }
            let _ = fs::remove_file(audio_path);
            let _ = fs::remove_file(metadata_path);
            total = total.saturating_sub(size);
        }
        Ok(())
    }
}

async fn checked_response(response: reqwest::Response, label: &str) -> Result<reqwest::Response, String> {
    if response.status().is_success() { return Ok(response); }
    let status = response.status();
    let message = response.text().await.unwrap_or_default();
    Err(provider_error(label, status, &message))
}

fn provider_error(label: &str, status: StatusCode, message: &str) -> String {
    format!("{label} failed with HTTP {}: {}", status.as_u16(), bounded_error(message))
}

fn bounded_error(message: &str) -> String {
    message.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(512).collect()
}

fn validate_speech_request(request: &MediaSpeechRequest, external: bool) -> Result<(), String> {
    validate_identifier(&request.request_id)?;
    validate_identifier(&request.profile_id)?;
    if external {
        validate_identifier(request.connection_id.as_deref().ok_or("media connection is required")?)?;
        if request.provider != "elevenlabs" || request.engine != "cloud" { return Err("unsupported external speech provider".into()); }
        if !valid_remote_id(request.voice.trim()) { return Err("invalid ElevenLabs voice identifier".into()); }
    } else if request.engine != "system" { return Err("invalid system speech request".into()); }
    if request.text.trim().is_empty() || request.text.chars().count() > 800 { return Err("speech text must contain 1 to 800 characters".into()); }
    if request.voice.chars().count() > 120 || request.model.chars().count() > 160 || request.lang.chars().count() > 40
        || !request.speed.is_finite() || !(0.6..=1.5).contains(&request.speed) { return Err("invalid speech settings".into()); }
    Ok(())
}

fn validate_music_request(request: &MediaMusicRequest) -> Result<(), String> {
    validate_identifier(&request.request_id)?;
    validate_identifier(&request.profile_id)?;
    validate_identifier(&request.connection_id)?;
    let prompt = request.prompt.trim();
    if prompt.is_empty() || prompt.chars().count() > 160
        || ["http:", "https:", "data:", "blob:", "file:", "javascript:"].iter().any(|prefix| prompt.to_lowercase().contains(prefix)) {
        return Err("music intent must contain 1 to 160 safe characters".into());
    }
    if !(3_000..=600_000).contains(&request.duration_ms) { return Err("music duration must be between 3 seconds and 10 minutes".into()); }
    Ok(())
}

fn validate_local_speech_cache_request(request: &LocalSpeechCacheRequest) -> Result<(), String> {
    validate_identifier(&request.profile_id)?;
    if request.text.trim().is_empty() || request.text.chars().count() > 800
        || request.voice.chars().count() > 120 || request.model.chars().count() > 160
        || request.lang.chars().count() > 40 || !request.speed.is_finite()
        || !(0.6..=1.5).contains(&request.speed) {
        return Err("invalid local speech cache request".into());
    }
    Ok(())
}

fn validate_kokoro_speech_request(request: &MediaSpeechRequest) -> Result<(), String> {
    validate_identifier(&request.request_id)?;
    validate_identifier(&request.profile_id)?;
    if request.engine != "local" || request.provider != "kokoro" || request.model != "kokoro-82m-q8" || request.voice != "af_heart" {
        return Err("unsupported packaged Kokoro speech settings".into());
    }
    if request.connection_id.is_some() {
        return Err("local speech must not include a media connection".into());
    }
    validate_local_speech_cache_request(&LocalSpeechCacheRequest {
        profile_id: request.profile_id.clone(),
        model: request.model.clone(),
        voice: request.voice.clone(),
        speed: request.speed,
        text: request.text.clone(),
        lang: request.lang.clone(),
    })
}

fn local_speech_cache_key(request: &LocalSpeechCacheRequest) -> String {
    media_cache_key(&json!({
        "schema": MEDIA_CACHE_SCHEMA,
        "kind": "speech",
        "provider": "kokoro-local",
        "model": request.model,
        "voice": request.voice,
        "speed": request.speed,
        "text": request.text,
        "lang": request.lang,
    }))
}

pub fn validate_identifier(value: &str) -> Result<(), String> {
    if !value.is_empty() && value != "." && value != ".." && value.len() <= 160
        && value.chars().all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character)) {
        Ok(())
    } else {
        Err("invalid media identifier".into())
    }
}

fn valid_remote_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160 && value.chars().all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
}

fn language_code(value: &str) -> Option<String> {
    let code = value.split(['-', '_']).next()?.to_lowercase();
    (code.len() == 2 && code.chars().all(|character| character.is_ascii_alphabetic())).then_some(code)
}

fn media_cache_key(value: &Value) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(value).unwrap_or_default()))
}

fn caption_words(alignment: &ElevenAlignment) -> Vec<CaptionWord> {
    let length = alignment.characters.len()
        .min(alignment.character_start_times_seconds.len())
        .min(alignment.character_end_times_seconds.len());
    let mut words = Vec::new();
    let mut text = String::new();
    let mut start = 0.0_f64;
    let mut end = 0.0_f64;
    for index in 0..length {
        let character = &alignment.characters[index];
        if character.chars().all(char::is_whitespace) {
            push_caption_word(&mut words, &mut text, start, end);
            continue;
        }
        if text.is_empty() { start = alignment.character_start_times_seconds[index]; }
        text.push_str(character);
        end = alignment.character_end_times_seconds[index];
    }
    push_caption_word(&mut words, &mut text, start, end);
    words
}

fn push_caption_word(words: &mut Vec<CaptionWord>, text: &mut String, start: f64, end: f64) {
    let word = text.trim();
    if !word.is_empty() && start.is_finite() && end.is_finite() && end >= start {
        words.push(CaptionWord {
            text: word.chars().take(80).collect(),
            start_ms: (start.max(0.0) * 1_000.0).round() as u64,
            end_ms: (end.max(start) * 1_000.0).round() as u64,
        });
    }
    text.clear();
}

fn asset_response(mime_type: String, duration_ms: u64, caption_words: Vec<CaptionWord>, bytes: Vec<u8>, cache_hit: bool) -> MediaAssetResponse {
    MediaAssetResponse { mime_type, data_base64: BASE64.encode(bytes), duration_ms, caption_words, cache_hit }
}

fn aiff_duration_ms(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 12 || &bytes[0..4] != b"FORM" || (&bytes[8..12] != b"AIFF" && &bytes[8..12] != b"AIFC") { return None; }
    let mut cursor = 12_usize;
    while cursor.checked_add(8)? <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32::from_be_bytes(bytes[cursor + 4..cursor + 8].try_into().ok()?) as usize;
        let content = cursor + 8;
        if id == b"COMM" && size >= 18 && content.checked_add(18)? <= bytes.len() {
            let frames = u32::from_be_bytes(bytes[content + 2..content + 6].try_into().ok()?) as f64;
            let rate = extended_80(&bytes[content + 8..content + 18])?;
            if frames > 0.0 && rate > 0.0 { return Some((frames / rate * 1_000.0).round() as u64); }
        }
        cursor = content.checked_add(size + (size % 2))?;
    }
    None
}

fn wav_duration_ms(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" { return None; }
    let mut cursor = 12_usize;
    let mut byte_rate = 0_u32;
    let mut data_bytes = 0_usize;
    while cursor.checked_add(8)? <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().ok()?) as usize;
        let content = cursor + 8;
        if id == b"fmt " && size >= 12 && content.checked_add(size)? <= bytes.len() {
            byte_rate = u32::from_le_bytes(bytes[content + 8..content + 12].try_into().ok()?);
        } else if id == b"data" {
            data_bytes = size.min(bytes.len().saturating_sub(content));
            break;
        }
        cursor = content.checked_add(size + (size % 2))?;
    }
    (byte_rate > 0 && data_bytes > 0).then(|| ((data_bytes as f64 / byte_rate as f64) * 1_000.0).round() as u64)
}

fn extended_80(bytes: &[u8]) -> Option<f64> {
    if bytes.len() != 10 { return None; }
    let sign = if bytes[0] & 0x80 == 0 { 1.0 } else { -1.0 };
    let exponent = (((bytes[0] & 0x7f) as u16) << 8) | bytes[1] as u16;
    let mantissa = u64::from_be_bytes(bytes[2..10].try_into().ok()?);
    if exponent == 0 && mantissa == 0 { return Some(0.0); }
    if exponent == 0x7fff { return None; }
    Some(sign * (mantissa as f64) * 2_f64.powi(exponent as i32 - 16_383 - 63))
}

#[cfg(test)]
mod tests {
    use super::{aiff_duration_ms, caption_words, media_cache_key, validate_identifier, wav_duration_ms, ElevenAlignment, LocalSpeechCacheRequest, MediaMusicRequest, MediaService, MediaSpeechRequest, StoreLocalSpeechCacheRequest};
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use uuid::Uuid;

    #[test]
    fn cache_keys_do_not_depend_on_object_identity() {
        let left = media_cache_key(&json!({"provider":"elevenlabs","text":"Hello"}));
        let right = media_cache_key(&json!({"provider":"elevenlabs","text":"Hello"}));
        assert_eq!(left, right);
        assert_ne!(left, media_cache_key(&json!({"provider":"elevenlabs","text":"Goodbye"})));
    }

    #[test]
    fn alignment_becomes_word_timestamps() {
        let alignment = ElevenAlignment {
            characters: vec!["H".into(), "i".into(), " ".into(), "O".into(), "z".into()],
            character_start_times_seconds: vec![0.0, 0.1, 0.2, 0.3, 0.4],
            character_end_times_seconds: vec![0.1, 0.2, 0.3, 0.4, 0.5],
        };
        let words = caption_words(&alignment);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Hi");
        assert_eq!(words[1].start_ms, 300);
        assert_eq!(words[1].end_ms, 500);
    }

    #[test]
    fn reads_exact_duration_from_system_voice_aiff() {
        let mut bytes = Vec::from(&b"FORM\0\0\0\x1eAIFFCOMM\0\0\0\x12"[..]);
        bytes.extend_from_slice(&1_u16.to_be_bytes());
        bytes.extend_from_slice(&44_100_u32.to_be_bytes());
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
        assert_eq!(aiff_duration_ms(&bytes), Some(1_000));
    }

    #[test]
    fn reads_exact_duration_from_local_kokoro_wav() {
        let samples = 48_000_u32;
        let mut bytes = vec![0_u8; 44 + samples as usize * 2];
        let riff_size = (bytes.len() - 8) as u32;
        bytes[0..4].copy_from_slice(b"RIFF");
        bytes[4..8].copy_from_slice(&riff_size.to_le_bytes());
        bytes[8..12].copy_from_slice(b"WAVE");
        bytes[12..16].copy_from_slice(b"fmt ");
        bytes[16..20].copy_from_slice(&16_u32.to_le_bytes());
        bytes[20..22].copy_from_slice(&1_u16.to_le_bytes());
        bytes[22..24].copy_from_slice(&1_u16.to_le_bytes());
        bytes[24..28].copy_from_slice(&24_000_u32.to_le_bytes());
        bytes[28..32].copy_from_slice(&48_000_u32.to_le_bytes());
        bytes[32..34].copy_from_slice(&2_u16.to_le_bytes());
        bytes[34..36].copy_from_slice(&16_u16.to_le_bytes());
        bytes[36..40].copy_from_slice(b"data");
        bytes[40..44].copy_from_slice(&(samples * 2).to_le_bytes());
        assert_eq!(wav_duration_ms(&bytes), Some(2_000));
    }

    #[test]
    fn identifiers_cannot_escape_profile_cache() {
        assert!(validate_identifier("personal").is_ok());
        assert!(validate_identifier("../personal").is_err());
        assert!(validate_identifier("with space").is_err());
    }

    #[test]
    fn cache_hits_are_profile_scoped_and_lru_eviction_is_bounded() {
        let root = std::env::temp_dir().join(format!("vibesurfer-media-test-{}", Uuid::new_v4()));
        let mut service = MediaService::new(root.clone()).unwrap();
        service.cache_limit_bytes = 6;
        let first = service.cache_put("personal", "first", "audio/wav", 1_000, Vec::new(), vec![1, 2, 3, 4]).unwrap();
        assert!(!first.cache_hit);
        assert!(service.cache_get("work", "first").unwrap().is_none());
        let hit = service.cache_get("personal", "first").unwrap().unwrap();
        assert!(hit.cache_hit);
        assert_eq!(hit.data_base64, "AQIDBA==");
        service.cache_put("personal", "second", "audio/wav", 1_000, Vec::new(), vec![5, 6, 7, 8]).unwrap();
        assert!(service.cache_get("personal", "first").unwrap().is_none());
        assert!(service.cache_get("personal", "second").unwrap().is_some());
        service.delete_profile_cache("personal").unwrap();
        assert!(!root.join("personal").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn local_kokoro_speech_uses_the_persistent_profile_cache() {
        let root = std::env::temp_dir().join(format!("vibesurfer-local-speech-cache-test-{}", Uuid::new_v4()));
        let service = MediaService::new(root.clone()).unwrap();
        let speech = LocalSpeechCacheRequest {
            profile_id: "personal".into(), model: "kokoro-82m-q8".into(), voice: "af_heart".into(),
            speed: 1.0, text: "A cached local sentence.".into(), lang: "en".into(),
        };
        assert!(service.cached_local_speech(&speech).unwrap().is_none());
        let stored = service.store_local_speech(&StoreLocalSpeechCacheRequest {
            speech: LocalSpeechCacheRequest { ..speech }, mime_type: "audio/wav".into(),
            data_base64: "UklGRg==".into(), duration_ms: 1_250,
        }).unwrap();
        assert!(!stored.cache_hit);
        let key = LocalSpeechCacheRequest {
            profile_id: "personal".into(), model: "kokoro-82m-q8".into(), voice: "af_heart".into(),
            speed: 1.0, text: "A cached local sentence.".into(), lang: "en".into(),
        };
        let hit = service.cached_local_speech(&key).unwrap().unwrap();
        assert!(hit.cache_hit);
        assert_eq!(hit.duration_ms, 1_250);
        assert!(service.cached_local_speech(&LocalSpeechCacheRequest { profile_id: "work".into(), ..key }).unwrap().is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn mocked_elevenlabs_timestamps_music_and_cache_never_persist_the_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = vec![0_u8; 32 * 1024];
                let size = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..size]).to_string();
                captured.lock().unwrap().push(request.clone());
                let (content_type, body) = if request.starts_with("GET /v2/voices") {
                    ("application/json", r#"{"voices":[{"voice_id":"voice-one","name":"One","category":"premade"}]}"#.as_bytes().to_vec())
                } else if request.starts_with("POST /v1/text-to-speech/") {
                    ("application/json", r#"{"audio_base64":"SUQzc3BlZWNo","alignment":{"characters":["H","i"],"character_start_times_seconds":[0.0,0.1],"character_end_times_seconds":[0.1,0.25]}}"#.as_bytes().to_vec())
                } else {
                    ("audio/mpeg", b"ID3music".to_vec())
                };
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });

        let root = std::env::temp_dir().join(format!("vibesurfer-media-http-test-{}", Uuid::new_v4()));
        let mut service = MediaService::new(root.clone()).unwrap();
        service.origin = origin;
        let api_key = "super-secret-media-key";
        let voices = service.verify_elevenlabs(api_key).await.unwrap();
        assert_eq!(voices[0].id, "voice-one");
        let speech = MediaSpeechRequest { request_id: "speech-one".into(), profile_id: "personal".into(), engine: "cloud".into(), connection_id: Some("media-one".into()), provider: "elevenlabs".into(), model: "eleven_multilingual_v2".into(), voice: "voice-one".into(), speed: 1.0, text: "Hi".into(), lang: "en".into() };
        let first = service.render_elevenlabs_speech(&speech, api_key).await.unwrap();
        assert_eq!(first.duration_ms, 250);
        assert!(!first.cache_hit);
        let second = service.render_elevenlabs_speech(&MediaSpeechRequest { request_id: "speech-two".into(), ..speech }, api_key).await.unwrap();
        assert!(second.cache_hit);
        let music = service.generate_elevenlabs_music(&MediaMusicRequest { request_id: "music-one".into(), profile_id: "personal".into(), connection_id: "media-one".into(), prompt: "quiet glass".into(), duration_ms: 3_000 }, api_key).await.unwrap();
        assert_eq!(music.duration_ms, 3_000);
        server.join().unwrap();
        assert_eq!(requests.lock().unwrap().len(), 3, "cache hit must not repeat the speech request");
        for entry in std::fs::read_dir(root.join("personal")).unwrap() {
            let bytes = std::fs::read(entry.unwrap().path()).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains(api_key));
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn media_requests_honor_cancellation_and_timeout() {
        let root = std::env::temp_dir().join(format!("vibesurfer-media-cancel-test-{}", Uuid::new_v4()));
        let service = Arc::new(MediaService::new(root.clone()).unwrap());
        let running = service.clone();
        let task = tokio::spawn(async move {
            running.run_cancellable("cancel-me", std::time::Duration::from_secs(5), std::future::pending::<Result<(), String>>()).await
        });
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        service.cancel("cancel-me").unwrap();
        assert_eq!(task.await.unwrap().unwrap_err(), "media request was cancelled");
        let timeout = service.run_cancellable("timeout-me", std::time::Duration::from_millis(1), std::future::pending::<Result<(), String>>()).await;
        assert_eq!(timeout.unwrap_err(), "media request timed out");
        let _ = std::fs::remove_dir_all(root);
    }
}
