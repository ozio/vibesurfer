use keyring::{Entry, Error as KeyringError};
use thiserror::Error;
use zeroize::Zeroizing;

const SERVICE: &str = "com.vibesurfer.browser.providers";
const MEDIA_SERVICE: &str = "com.vibesurfer.browser.media";

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("invalid secret identifier")]
    InvalidIdentifier,
    #[error("credential store error: {0}")]
    Store(String),
}

#[derive(Clone, Default)]
pub struct SecretVault;

impl SecretVault {
    pub fn ensure_connection_scope(
        &self,
        profile_id: &str,
        connection_id: &str,
        secret_ref: &str,
    ) -> Result<(), SecretError> {
        let expected = secret_reference(profile_id, connection_id)?;
        validate_secret_ref(secret_ref)?;
        if secret_ref == expected {
            Ok(())
        } else {
            Err(SecretError::InvalidIdentifier)
        }
    }

    pub fn put(
        &self,
        profile_id: &str,
        connection_id: &str,
        secret: Zeroizing<String>,
    ) -> Result<String, SecretError> {
        let secret_ref = secret_reference(profile_id, connection_id)?;
        if secret.trim().is_empty() {
            return Err(SecretError::InvalidIdentifier);
        }

        entry(&secret_ref)?
            .set_password(secret.as_str())
            .map_err(|error| SecretError::Store(error.to_string()))?;
        Ok(secret_ref)
    }

    pub fn get(&self, secret_ref: &str) -> Result<Zeroizing<String>, SecretError> {
        validate_secret_ref(secret_ref)?;
        let secret = entry(secret_ref)?
            .get_password()
            .map_err(|error| SecretError::Store(error.to_string()))?;
        Ok(Zeroizing::new(secret))
    }

    pub fn exists(&self, secret_ref: &str) -> Result<bool, SecretError> {
        validate_secret_ref(secret_ref)?;
        match entry(secret_ref)?.get_password() {
            Ok(_) => Ok(true),
            Err(KeyringError::NoEntry) => Ok(false),
            Err(error) => Err(SecretError::Store(error.to_string())),
        }
    }

    pub fn delete(&self, secret_ref: &str) -> Result<(), SecretError> {
        validate_secret_ref(secret_ref)?;
        match entry(secret_ref)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(SecretError::Store(error.to_string())),
        }
    }
}

#[derive(Clone, Default)]
pub struct MediaSecretVault;

impl MediaSecretVault {
    pub fn ensure_connection_scope(
        &self,
        profile_id: &str,
        connection_id: &str,
        secret_ref: &str,
    ) -> Result<(), SecretError> {
        let expected = secret_reference(profile_id, connection_id)?;
        validate_secret_ref(secret_ref)?;
        if secret_ref == expected { Ok(()) } else { Err(SecretError::InvalidIdentifier) }
    }

    pub fn put(
        &self,
        profile_id: &str,
        connection_id: &str,
        secret: Zeroizing<String>,
    ) -> Result<String, SecretError> {
        let secret_ref = secret_reference(profile_id, connection_id)?;
        if secret.trim().is_empty() { return Err(SecretError::InvalidIdentifier); }
        media_entry(&secret_ref)?
            .set_password(secret.as_str())
            .map_err(|error| SecretError::Store(error.to_string()))?;
        Ok(secret_ref)
    }

    pub fn get(&self, secret_ref: &str) -> Result<Zeroizing<String>, SecretError> {
        validate_secret_ref(secret_ref)?;
        let secret = media_entry(secret_ref)?
            .get_password()
            .map_err(|error| SecretError::Store(error.to_string()))?;
        Ok(Zeroizing::new(secret))
    }

    pub fn delete(&self, secret_ref: &str) -> Result<(), SecretError> {
        validate_secret_ref(secret_ref)?;
        match media_entry(secret_ref)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(SecretError::Store(error.to_string())),
        }
    }
}

fn secret_reference(profile_id: &str, connection_id: &str) -> Result<String, SecretError> {
    validate_identifier(profile_id)?;
    validate_identifier(connection_id)?;
    Ok(format!("{profile_id}:{connection_id}"))
}

fn entry(secret_ref: &str) -> Result<Entry, SecretError> {
    Entry::new(SERVICE, secret_ref).map_err(|error| SecretError::Store(error.to_string()))
}

fn media_entry(secret_ref: &str) -> Result<Entry, SecretError> {
    Entry::new(MEDIA_SERVICE, secret_ref).map_err(|error| SecretError::Store(error.to_string()))
}

fn validate_secret_ref(value: &str) -> Result<(), SecretError> {
    let Some((profile_id, connection_id)) = value.split_once(':') else {
        return Err(SecretError::InvalidIdentifier);
    };
    validate_identifier(profile_id)?;
    validate_identifier(connection_id)
}

fn validate_identifier(value: &str) -> Result<(), SecretError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character));
    if valid {
        Ok(())
    } else {
        Err(SecretError::InvalidIdentifier)
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_identifier, validate_secret_ref, SecretVault};

    #[test]
    fn secret_identifiers_are_bounded_and_portable() {
        assert!(validate_identifier("openai-main").is_ok());
        assert!(validate_identifier("personal:openai-main").is_err());
        assert!(validate_identifier("").is_err());
        assert!(validate_identifier("../escape").is_err());
        assert!(validate_identifier("contains space").is_err());
        assert!(validate_secret_ref("personal:openai-main").is_ok());
        assert!(validate_secret_ref("personal:openai:main").is_err());
        assert!(SecretVault
            .ensure_connection_scope("personal", "openai-main", "personal:openai-main")
            .is_ok());
        assert!(SecretVault
            .ensure_connection_scope("personal", "anthropic-main", "personal:openai-main")
            .is_err());
        assert!(SecretVault
            .ensure_connection_scope("work", "openai-main", "personal:openai-main")
            .is_err());
    }
}
