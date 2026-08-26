use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const PROTOCOL_VERSION: u32 = 1;
pub const SIDECAR_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_REQUEST_BYTES: u64 = 1024 * 1024;
const MAX_ENVIRONMENT_ENTRIES: usize = 512;
const MAX_ROOTS_PER_KIND: usize = 256;
const MAX_SUPERVISOR_PROCESSES: usize = 4;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionProfile {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SandboxRunRequest {
    pub protocol_version: u32,
    pub execution_id: String,
    pub supervisor_pids: Vec<u32>,
    pub command: String,
    pub cwd: PathBuf,
    pub workspace_root: PathBuf,
    pub permission_profile: PermissionProfile,
    #[serde(default)]
    pub readable_roots: Vec<PathBuf>,
    #[serde(default)]
    pub writable_roots: Vec<PathBuf>,
    #[serde(default)]
    pub ephemeral_writable_roots: Vec<PathBuf>,
    #[serde(default)]
    pub denied_roots: Vec<PathBuf>,
    #[serde(default)]
    pub denied_glob_reg_exp_sources: Vec<String>,
    #[serde(default)]
    pub protected_writable_roots: Vec<PathBuf>,
    #[serde(default)]
    pub network_access: bool,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}

impl SandboxRunRequest {
    pub fn from_file(path: &Path) -> Result<Self, SandboxError> {
        let metadata = fs::metadata(path).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::InvalidRequest,
                format!("cannot inspect request file {}", path.display()),
                error,
            )
        })?;
        if !metadata.is_file() || metadata.len() > MAX_REQUEST_BYTES {
            return Err(SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                "sandbox request file is missing, not a file, or too large",
            ));
        }
        let bytes = fs::read(path).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::InvalidRequest,
                format!("cannot read request file {}", path.display()),
                error,
            )
        })?;
        let request = serde_json::from_slice::<Self>(&bytes).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::InvalidRequest,
                "sandbox request is not valid protocol JSON",
                error,
            )
        })?;
        request.validate()?;
        Ok(request)
    }

    pub fn validate(&self) -> Result<(), SandboxError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(SandboxError::new(
                SandboxErrorCode::ProtocolMismatch,
                format!(
                    "unsupported protocol version {}; expected {PROTOCOL_VERSION}",
                    self.protocol_version
                ),
            ));
        }
        if self.execution_id.is_empty()
            || self.execution_id.len() > 128
            || !self
                .execution_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                "executionId must contain 1-128 ASCII letters, digits, '-' or '_'",
            ));
        }
        if self.command.trim().is_empty() || self.command.contains('\0') {
            return Err(SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                "command must be non-empty and cannot contain NUL",
            ));
        }
        if self.supervisor_pids.is_empty()
            || self.supervisor_pids.len() > MAX_SUPERVISOR_PROCESSES
            || self.supervisor_pids.contains(&0)
            || self.supervisor_pids.iter().collect::<HashSet<_>>().len()
                != self.supervisor_pids.len()
        {
            return Err(SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                "supervisorPids must contain 1-4 distinct non-zero process ids",
            ));
        }
        for (label, path) in [("cwd", &self.cwd), ("workspaceRoot", &self.workspace_root)] {
            if !path.is_absolute() {
                return Err(SandboxError::new(
                    SandboxErrorCode::InvalidRequest,
                    format!("{label} must be absolute"),
                ));
            }
        }
        for (label, roots) in [
            ("readableRoots", &self.readable_roots),
            ("writableRoots", &self.writable_roots),
            ("ephemeralWritableRoots", &self.ephemeral_writable_roots),
            ("deniedRoots", &self.denied_roots),
            ("protectedWritableRoots", &self.protected_writable_roots),
        ] {
            validate_roots(label, roots)?;
        }
        // WRITE_RESTRICTED tokens can make write denies authoritative. They cannot
        // enforce path-specific read denies, and NTFS ACLs cannot represent globs.
        // Reject these policies so the runtime can request a narrower approval.
        if !self.denied_roots.is_empty() || !self.denied_glob_reg_exp_sources.is_empty() {
            return Err(SandboxError::new(
                SandboxErrorCode::UnsupportedPolicy,
                "Windows native sandbox V1 cannot enforce denied roots or denied globs",
            ));
        }
        if self.environment.len() > MAX_ENVIRONMENT_ENTRIES {
            return Err(SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                "sandbox environment has too many entries",
            ));
        }
        let mut folded_environment_keys = HashSet::new();
        for (key, value) in &self.environment {
            if key.is_empty() || key.contains(['\0', '=']) || value.contains('\0') {
                return Err(SandboxError::new(
                    SandboxErrorCode::InvalidRequest,
                    "sandbox environment contains an invalid key or NUL value",
                ));
            }
            if !folded_environment_keys.insert(key.to_ascii_uppercase()) {
                return Err(SandboxError::new(
                    SandboxErrorCode::InvalidRequest,
                    format!("sandbox environment contains duplicate key {key}"),
                ));
            }
        }
        Ok(())
    }
}

fn validate_roots(label: &str, roots: &[PathBuf]) -> Result<(), SandboxError> {
    if roots.len() > MAX_ROOTS_PER_KIND {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            format!("{label} contains too many roots"),
        ));
    }
    if roots.iter().any(|root| !root.is_absolute()) {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            format!("{label} must contain only absolute paths"),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxStatusKind {
    Unsupported,
    NotInstalled,
    Ready,
    NeedsRepair,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    pub protocol_version: u32,
    pub sidecar_version: String,
    pub platform: String,
    pub state: SandboxStatusKind,
    pub reason: String,
    pub install_supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
}

impl SandboxStatus {
    #[cfg(not(windows))]
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            sidecar_version: SIDECAR_VERSION.to_string(),
            platform: std::env::consts::OS.to_string(),
            state: SandboxStatusKind::Unsupported,
            reason: reason.into(),
            install_supported: false,
            installed_version: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxErrorCode {
    InvalidArguments,
    InvalidRequest,
    ProtocolMismatch,
    UnsupportedPlatform,
    UnsupportedPolicy,
    NotInstalled,
    NeedsRepair,
    ElevationCancelled,
    SetupFailed,
    SpawnFailed,
    Internal,
}

impl SandboxErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArguments => "invalid-arguments",
            Self::InvalidRequest => "invalid-request",
            Self::ProtocolMismatch => "protocol-mismatch",
            Self::UnsupportedPlatform => "unsupported-platform",
            Self::UnsupportedPolicy => "unsupported-policy",
            Self::NotInstalled => "not-installed",
            Self::NeedsRepair => "needs-repair",
            Self::ElevationCancelled => "elevation-cancelled",
            Self::SetupFailed => "setup-failed",
            Self::SpawnFailed => "spawn-failed",
            Self::Internal => "internal",
        }
    }
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct SandboxError {
    pub code: SandboxErrorCode,
    pub message: String,
    #[source]
    source: Option<anyhow::Error>,
}

impl SandboxError {
    pub fn new(code: SandboxErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub fn with_source(
        code: SandboxErrorCode,
        message: impl Into<String>,
        source: impl Into<anyhow::Error>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            source: Some(source.into()),
        }
    }

    pub fn exit_code(&self) -> i32 {
        match self.code {
            SandboxErrorCode::InvalidArguments | SandboxErrorCode::InvalidRequest => 2,
            SandboxErrorCode::ProtocolMismatch => 3,
            SandboxErrorCode::UnsupportedPlatform | SandboxErrorCode::UnsupportedPolicy => 4,
            SandboxErrorCode::NotInstalled | SandboxErrorCode::NeedsRepair => 5,
            SandboxErrorCode::ElevationCancelled => 6,
            SandboxErrorCode::SetupFailed => 7,
            SandboxErrorCode::SpawnFailed => 8,
            SandboxErrorCode::Internal => 10,
        }
    }

    pub fn detailed_message(&self) -> String {
        match &self.source {
            Some(source) => format!("{}: {source:#}", self.message),
            None => self.message.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorOutput {
    pub code: SandboxErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SandboxStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorOutput>,
    #[serde(skip)]
    pub emit: bool,
    #[serde(skip)]
    pub exit_code: i32,
}

impl CommandOutput {
    pub fn status(status: SandboxStatus) -> Self {
        Self {
            ok: matches!(status.state, SandboxStatusKind::Ready),
            status: Some(status),
            version: None,
            error: None,
            emit: true,
            exit_code: 0,
        }
    }

    pub fn success() -> Self {
        Self {
            ok: true,
            status: None,
            version: None,
            error: None,
            emit: true,
            exit_code: 0,
        }
    }

    pub fn version() -> Self {
        Self {
            ok: true,
            status: None,
            version: Some(SIDECAR_VERSION.to_string()),
            error: None,
            emit: true,
            exit_code: 0,
        }
    }

    pub fn process_exit(exit_code: i32) -> Self {
        Self {
            ok: exit_code == 0,
            status: None,
            version: None,
            error: None,
            emit: false,
            exit_code,
        }
    }

    pub fn failure(error: &SandboxError) -> Self {
        Self {
            ok: false,
            status: None,
            version: None,
            error: Some(ErrorOutput {
                code: error.code,
                message: error.detailed_message(),
            }),
            emit: true,
            exit_code: error.exit_code(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> SandboxRunRequest {
        let root = std::env::current_dir().expect("cwd");
        SandboxRunRequest {
            protocol_version: PROTOCOL_VERSION,
            execution_id: "execution_1".to_string(),
            supervisor_pids: vec![1],
            command: "echo hello".to_string(),
            cwd: root.clone(),
            workspace_root: root.clone(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            readable_roots: vec![root.clone()],
            writable_roots: vec![root],
            ephemeral_writable_roots: Vec::new(),
            denied_roots: Vec::new(),
            denied_glob_reg_exp_sources: Vec::new(),
            protected_writable_roots: Vec::new(),
            network_access: false,
            environment: BTreeMap::new(),
        }
    }

    #[test]
    fn accepts_minimal_request() {
        request().validate().expect("valid request");
    }

    #[test]
    fn rejects_unrepresentable_deny_policy() {
        let mut input = request();
        input
            .denied_glob_reg_exp_sources
            .push(".*\\.env".to_string());
        let error = input.validate().expect_err("deny glob must fail closed");
        assert_eq!(error.code, SandboxErrorCode::UnsupportedPolicy);
    }

    #[test]
    fn rejects_case_insensitive_environment_duplicates() {
        let mut input = request();
        input
            .environment
            .insert("Path".to_string(), "a".to_string());
        input
            .environment
            .insert("PATH".to_string(), "b".to_string());
        let error = input.validate().expect_err("duplicate key must fail");
        assert_eq!(error.code, SandboxErrorCode::InvalidRequest);
    }

    #[test]
    fn requires_a_live_supervisor_contract() {
        let mut input = request();
        input.supervisor_pids.clear();
        let error = input.validate().expect_err("supervisor must fail closed");
        assert_eq!(error.code, SandboxErrorCode::InvalidRequest);
    }

    #[test]
    fn failure_output_includes_the_underlying_os_error() {
        let error = SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "sandbox process creation failed",
            std::io::Error::from_raw_os_error(5),
        );
        let output = CommandOutput::failure(&error);

        assert!(output
            .error
            .expect("failure details")
            .message
            .contains("os error 5"));
    }
}
