use crate::protocol::{SandboxError, SandboxErrorCode, SandboxRunRequest};
use crate::state::CapabilityRecord;
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;

// Changing the ACL materialization strategy must produce a fresh capability.
// Otherwise an interrupted grant from an older build can leave the root ACE in
// place while descendants are only partially authorized, and later runs would
// incorrectly treat that policy as prepared.
const CAPABILITY_POLICY_VERSION: &[u8] = b"setsuna-windows-sandbox-acl-v2";

pub fn policy_key(request: &SandboxRunRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(CAPABILITY_POLICY_VERSION);
    hasher.update([0]);
    hasher.update(request.workspace_root.to_string_lossy().to_lowercase());
    hasher.update([0]);
    hasher.update(format!("{:?}", request.permission_profile));
    let ephemeral = request
        .ephemeral_writable_roots
        .iter()
        .map(|root| root_key(root))
        .collect::<HashSet<_>>();
    for root in stable_root_keys(&request.writable_roots) {
        if ephemeral.contains(&root) {
            continue;
        }
        hasher.update([0]);
        hasher.update(root);
    }
    for root in stable_root_keys(&request.protected_writable_roots) {
        hasher.update([1]);
        hasher.update(root);
    }
    format!("{:x}", hasher.finalize())
}

fn stable_root_keys(roots: &[std::path::PathBuf]) -> Vec<String> {
    let mut keys = roots.iter().map(|root| root_key(root)).collect::<Vec<_>>();
    keys.sort_unstable();
    keys.dedup();
    keys
}

fn root_key(root: &Path) -> String {
    root.to_string_lossy().to_lowercase()
}

pub fn new_capability_record() -> CapabilityRecord {
    let mut values = [0_u32; 4];
    for value in &mut values {
        *value = OsRng.next_u32();
    }
    CapabilityRecord {
        sid: format!(
            "S-1-5-21-{}-{}-{}-{}",
            values[0], values[1], values[2], values[3]
        ),
    }
}

pub fn validate_capability_sid(value: &str) -> Result<(), SandboxError> {
    let components = value.split('-').collect::<Vec<_>>();
    let valid = components.len() == 8
        && components[..4] == ["S", "1", "5", "21"]
        && components[4..]
            .iter()
            .all(|component| component.parse::<u32>().is_ok());
    if valid {
        Ok(())
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            "capability SID has an invalid format",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{PermissionProfile, PROTOCOL_VERSION};
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn request(writable_roots: Vec<PathBuf>) -> SandboxRunRequest {
        SandboxRunRequest {
            protocol_version: PROTOCOL_VERSION,
            execution_id: "one".to_string(),
            supervisor_pids: vec![1],
            command: "echo one".to_string(),
            cwd: PathBuf::from("/workspace"),
            workspace_root: PathBuf::from("/workspace"),
            permission_profile: PermissionProfile::WorkspaceWrite,
            readable_roots: vec![PathBuf::from("/workspace")],
            writable_roots,
            ephemeral_writable_roots: Vec::new(),
            denied_roots: Vec::new(),
            denied_glob_reg_exp_sources: Vec::new(),
            protected_writable_roots: Vec::new(),
            network_access: false,
            environment: BTreeMap::new(),
        }
    }

    #[test]
    fn policy_key_is_stable_but_permission_sensitive() {
        let first = request(vec![PathBuf::from("/workspace")]);
        let mut second = first.clone();
        assert_eq!(policy_key(&first), policy_key(&second));
        second.writable_roots.push(PathBuf::from("/cache"));
        assert_ne!(policy_key(&first), policy_key(&second));
    }

    #[test]
    fn policy_key_ignores_per_execution_writable_roots() {
        let mut first = request(vec![
            PathBuf::from("/workspace"),
            PathBuf::from("/temp/one/work"),
        ]);
        first.ephemeral_writable_roots = vec![PathBuf::from("/temp/one/work")];
        let mut second = request(vec![
            PathBuf::from("/temp/two/work"),
            PathBuf::from("/workspace"),
        ]);
        second.ephemeral_writable_roots = vec![PathBuf::from("/temp/two/work")];

        assert_eq!(policy_key(&first), policy_key(&second));
    }

    #[test]
    fn generated_sid_round_trips_validator() {
        validate_capability_sid(&new_capability_record().sid).expect("valid generated SID");
    }
}
