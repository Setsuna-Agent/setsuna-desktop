use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode, SandboxRunRequest};
use std::path::{Component, Path, PathBuf};
use windows_sys::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetVolumeInformationW, GetVolumePathNameW,
};
use windows_sys::Win32::System::WindowsProgramming::DRIVE_FIXED;

pub fn validate_request_paths(
    request: &SandboxRunRequest,
    request_path: &Path,
) -> Result<(), SandboxError> {
    let workspace = validate_directory(&request.workspace_root, "workspaceRoot")?;
    let cwd = validate_directory(&request.cwd, "cwd")?;
    if !path_is_within(&cwd, &workspace)
        && !request
            .readable_roots
            .iter()
            .filter_map(|root| canonical_existing(root).ok())
            .any(|root| path_is_within(&cwd, &root))
    {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            "cwd must be inside the workspace or an approved readable root",
        ));
    }
    validate_file(request_path, "request file")?;
    for root in &request.readable_roots {
        validate_readable_path(root, "readableRoots")?;
    }
    for (label, roots) in [
        ("writableRoots", &request.writable_roots),
        ("ephemeralWritableRoots", &request.ephemeral_writable_roots),
        ("protectedWritableRoots", &request.protected_writable_roots),
    ] {
        for root in roots {
            validate_directory(root, label)?;
        }
    }
    let request_parent = request_path.parent().ok_or_else(|| {
        SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            "sandbox request file has no parent directory",
        )
    })?;
    let request_parent = canonical_existing(request_parent)?;
    for ephemeral in &request.ephemeral_writable_roots {
        let ephemeral = canonical_existing(ephemeral)?;
        let is_writable = request.writable_roots.iter().any(|root| {
            canonical_existing(root)
                .map(|root| root == ephemeral)
                .unwrap_or(false)
        });
        if !is_writable
            || ephemeral == request_parent
            || !path_is_within(&ephemeral, &request_parent)
        {
            return Err(SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                format!(
                    "ephemeral writable root {} must be a writable child of the request directory",
                    ephemeral.display()
                ),
            ));
        }
    }
    for protected in &request.protected_writable_roots {
        let protected = canonical_existing(protected)?;
        if !request.writable_roots.iter().any(|root| {
            canonical_existing(root)
                .map(|root| path_is_within(&protected, &root))
                .unwrap_or(false)
        }) {
            return Err(SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                format!(
                    "protected writable root {} is not inside an approved writable root",
                    protected.display()
                ),
            ));
        }
    }
    Ok(())
}

pub fn canonical_existing(path: &Path) -> Result<PathBuf, SandboxError> {
    reject_unsafe_input_path(path)?;
    std::fs::canonicalize(path).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!("sandbox path must already exist: {}", path.display()),
            error,
        )
    })
}

pub fn path_is_within(path: &Path, root: &Path) -> bool {
    let folded_path = folded_components(path);
    let folded_root = folded_components(root);
    folded_path.len() >= folded_root.len()
        && folded_path
            .iter()
            .zip(folded_root.iter())
            .all(|(left, right)| left == right)
}

fn validate_readable_path(path: &Path, label: &str) -> Result<PathBuf, SandboxError> {
    let canonical = canonical_existing(path)?;
    if !canonical.is_dir() && !canonical.is_file() {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            format!("{label} is not a file or directory: {}", path.display()),
        ));
    }
    validate_fixed_ntfs(&canonical, label)?;
    Ok(canonical)
}

fn validate_directory(path: &Path, label: &str) -> Result<PathBuf, SandboxError> {
    let canonical = canonical_existing(path)?;
    if !canonical.is_dir() {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            format!("{label} is not a directory: {}", path.display()),
        ));
    }
    validate_fixed_ntfs(&canonical, label)?;
    Ok(canonical)
}

fn validate_file(path: &Path, label: &str) -> Result<PathBuf, SandboxError> {
    let canonical = canonical_existing(path)?;
    if !canonical.is_file() {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            format!("{label} is not a file: {}", path.display()),
        ));
    }
    validate_fixed_ntfs(&canonical, label)?;
    Ok(canonical)
}

fn validate_fixed_ntfs(path: &Path, label: &str) -> Result<(), SandboxError> {
    let path_wide = to_wide(path.as_os_str());
    let mut volume_path = vec![0_u16; 32_768];
    if unsafe {
        GetVolumePathNameW(
            path_wide.as_ptr(),
            volume_path.as_mut_ptr(),
            volume_path.len() as u32,
        )
    } == 0
    {
        return Err(SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot resolve volume for {label}: {}", path.display()),
            std::io::Error::last_os_error(),
        ));
    }
    if unsafe { GetDriveTypeW(volume_path.as_ptr()) } != DRIVE_FIXED {
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!("{label} must be on a fixed local drive"),
        ));
    }
    let mut file_system = vec![0_u16; 64];
    if unsafe {
        GetVolumeInformationW(
            volume_path.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            file_system.as_mut_ptr(),
            file_system.len() as u32,
        )
    } == 0
    {
        return Err(SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot inspect filesystem for {label}"),
            std::io::Error::last_os_error(),
        ));
    }
    let length = file_system
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(file_system.len());
    let name = String::from_utf16_lossy(&file_system[..length]);
    if !name.eq_ignore_ascii_case("NTFS") {
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!("{label} must be on NTFS; found {name}"),
        ));
    }
    Ok(())
}

fn reject_unsafe_input_path(path: &Path) -> Result<(), SandboxError> {
    let text = path.as_os_str().to_string_lossy();
    if text.starts_with("\\\\") || text.starts_with("//") || !path.is_absolute() {
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "UNC, device, mapped-network, or relative paths are unsupported: {}",
                path.display()
            ),
        ));
    }
    Ok(())
}

fn folded_components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|component| match component {
            Component::Prefix(prefix) => Some(prefix.as_os_str().to_string_lossy().to_lowercase()),
            Component::RootDir => Some("\\".to_string()),
            Component::Normal(value) => Some(value.to_string_lossy().to_lowercase()),
            Component::CurDir | Component::ParentDir => None,
        })
        .collect()
}
