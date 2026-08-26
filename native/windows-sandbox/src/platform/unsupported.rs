use crate::protocol::{CommandOutput, SandboxError, SandboxErrorCode, SandboxStatus};
use std::path::Path;

pub fn status() -> Result<CommandOutput, SandboxError> {
    Ok(CommandOutput::status(SandboxStatus::unsupported(
        "Windows native sandbox is available only on Windows x64",
    )))
}

pub fn doctor() -> Result<CommandOutput, SandboxError> {
    status()
}

pub fn install(_repair: bool) -> Result<CommandOutput, SandboxError> {
    unsupported()
}

pub fn uninstall() -> Result<CommandOutput, SandboxError> {
    unsupported()
}

pub fn run(_request_path: &Path) -> Result<CommandOutput, SandboxError> {
    unsupported()
}

pub fn internal_child(
    _request_path: &Path,
    _capability_sid: &str,
    _owner_sid: &str,
) -> Result<CommandOutput, SandboxError> {
    unsupported()
}

pub fn install_elevated(_owner_sid: &str) -> Result<CommandOutput, SandboxError> {
    unsupported()
}

pub fn uninstall_elevated() -> Result<CommandOutput, SandboxError> {
    unsupported()
}

fn unsupported<T>() -> Result<T, SandboxError> {
    Err(SandboxError::new(
        SandboxErrorCode::UnsupportedPlatform,
        "Windows native sandbox is available only on Windows x64",
    ))
}
