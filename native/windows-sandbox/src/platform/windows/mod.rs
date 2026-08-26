mod accounts;
mod acl;
mod bootstrap;
mod dpapi;
mod elevation;
mod firewall;
mod handle;
mod job;
mod paths;
mod process;
mod token;
mod visibility;
mod wfp;
mod wide;

use crate::capability::{new_capability_record, policy_key, validate_capability_sid};
use crate::protocol::{
    CommandOutput, PermissionProfile, SandboxError, SandboxErrorCode, SandboxRunRequest,
    SandboxStatus, SandboxStatusKind, PROTOCOL_VERSION, SIDECAR_VERSION,
};
use crate::state::{
    InstalledState, SandboxAccountState, StateStore, OFFLINE_USERNAME, ONLINE_USERNAME,
    PROXY_PORT_END, PROXY_PORT_START, SANDBOX_GROUP, STATE_SCHEMA_VERSION,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[allow(clippy::unnecessary_wraps)]
pub fn status() -> Result<CommandOutput, SandboxError> {
    Ok(CommandOutput::status(current_status()))
}

/// Settings uses this deeper check. The runtime's per-command capability probe
/// deliberately keeps using `status` so it does not spawn two extra processes.
pub fn doctor() -> Result<CommandOutput, SandboxError> {
    let status = current_status();
    if status.state != SandboxStatusKind::Ready {
        return Ok(CommandOutput::status(status));
    }

    let installed_version = status.installed_version.clone();
    for (stage, network_access) in [("offline-account", false), ("online-account", true)] {
        if let Err(error) = run_execution_probe(network_access) {
            return Ok(CommandOutput::status(status_value(
                SandboxStatusKind::NeedsRepair,
                format!(
                    "Windows sandbox execution check failed.\nStage: {stage}\nCode: {}\nDetails: {}",
                    error.code.as_str(),
                    error.detailed_message(),
                ),
                installed_version,
            )));
        }
    }

    Ok(CommandOutput::status(status))
}

pub fn install(repair: bool) -> Result<CommandOutput, SandboxError> {
    let existing = current_status();
    if !repair && existing.state == SandboxStatusKind::Ready {
        return doctor();
    }
    let owner_sid = accounts::current_user_sid_string()?;
    elevation::run_elevated("install-elevated", &["--owner-sid", &owner_sid])?;
    let installed = current_status();
    if installed.state != SandboxStatusKind::Ready {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            installed.reason,
        ));
    }
    doctor()
}

pub fn uninstall() -> Result<CommandOutput, SandboxError> {
    elevation::run_elevated("uninstall-elevated", &[])?;
    Ok(CommandOutput::status(current_status()))
}

pub fn install_elevated(owner_sid: &str) -> Result<CommandOutput, SandboxError> {
    if !accounts::is_process_elevated()? {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            "sandbox setup requires an elevated administrator process",
        ));
    }
    accounts::validate_sid_string(owner_sid)?;
    let store = state_store()?;
    fs::create_dir_all(store.directory()).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            format!(
                "cannot create sandbox state directory {}",
                store.directory().display()
            ),
            error,
        )
    })?;
    let _maintenance = store.acquire_maintenance_lock()?;
    let provisioned = accounts::provision_accounts()?;
    visibility::hide_users(&[OFFLINE_USERNAME, ONLINE_USERNAME])?;

    // The directory DACL is installed before any machine-scope DPAPI blob is
    // written. Sandbox accounts are explicitly denied even if a parent grants
    // broad local-user access.
    acl::protect_state_path(store.directory(), owner_sid, &provisioned.group_sid)?;
    acl::initialize_mutation_lock(&store.acl_lock_path())?;
    acl::protect_state_path(&store.acl_lock_path(), owner_sid, &provisioned.group_sid)?;
    acl::protect_state_path(&store.lifecycle_path(), owner_sid, &provisioned.group_sid)?;
    firewall::install(
        &provisioned.offline_sid,
        &provisioned.online_sid,
        PROXY_PORT_START,
        PROXY_PORT_END,
    )?;
    wfp::install(
        owner_sid,
        &provisioned.offline_sid,
        &provisioned.online_sid,
        PROXY_PORT_START,
        PROXY_PORT_END,
    )?;
    bootstrap::install(&store, owner_sid, &provisioned.group_sid)?;

    let state = InstalledState {
        schema_version: STATE_SCHEMA_VERSION,
        installed_version: SIDECAR_VERSION.to_string(),
        owner_sid: owner_sid.to_string(),
        group_sid: provisioned.group_sid,
        offline: SandboxAccountState {
            username: OFFLINE_USERNAME.to_string(),
            sid: provisioned.offline_sid,
            encrypted_password: BASE64
                .encode(dpapi::protect(provisioned.offline_password.as_bytes())?),
        },
        online: SandboxAccountState {
            username: ONLINE_USERNAME.to_string(),
            sid: provisioned.online_sid,
            encrypted_password: BASE64
                .encode(dpapi::protect(provisioned.online_password.as_bytes())?),
        },
        proxy_port_start: PROXY_PORT_START,
        proxy_port_end: PROXY_PORT_END,
        capabilities: BTreeMap::new(),
    };
    store.write_new(&state)?;
    acl::protect_state_path(&store.state_path(), owner_sid, &state.group_sid)?;
    acl::protect_state_path(&store.lock_path(), owner_sid, &state.group_sid)?;
    acl::protect_state_path(&store.acl_lock_path(), owner_sid, &state.group_sid)?;
    acl::protect_state_path(&store.lifecycle_path(), owner_sid, &state.group_sid)?;
    Ok(CommandOutput::success())
}

pub fn uninstall_elevated() -> Result<CommandOutput, SandboxError> {
    if !accounts::is_process_elevated()? {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            "sandbox uninstall requires an elevated administrator process",
        ));
    }
    let store = state_store()?;
    fs::create_dir_all(store.directory()).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            format!(
                "cannot create sandbox state directory {}",
                store.directory().display()
            ),
            error,
        )
    })?;
    let maintenance = store.acquire_maintenance_lock()?;
    let installed = store.read().ok().flatten();
    let removed_from_state = if let Some(installed) = &installed {
        accounts::remove_accounts(
            &installed.offline.sid,
            &installed.online.sid,
            &installed.group_sid,
        )
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            "sandbox state is unavailable during uninstall",
        ))
    };
    if removed_from_state.is_err() {
        // A corrupt or version-mismatched state must not make uninstall
        // impossible. Exact management markers still prevent name takeover.
        accounts::remove_marked_accounts()?;
    }
    visibility::unhide_users(&[OFFLINE_USERNAME, ONLINE_USERNAME])?;
    firewall::uninstall()?;
    wfp::uninstall()?;
    bootstrap::uninstall(&store)?;
    drop(maintenance);
    if store.directory().exists() {
        fs::remove_dir_all(store.directory()).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SetupFailed,
                format!(
                    "cannot remove sandbox state directory {}",
                    store.directory().display()
                ),
                error,
            )
        })?;
    }
    Ok(CommandOutput::success())
}

pub fn run(request_path: &Path) -> Result<CommandOutput, SandboxError> {
    let request = SandboxRunRequest::from_file(request_path)?;
    paths::validate_request_paths(&request, request_path)?;
    let store = state_store()?;
    let _execution = store.acquire_execution_lock()?;
    let installed = store.read()?.ok_or_else(|| {
        SandboxError::new(
            SandboxErrorCode::NotInstalled,
            "Windows native sandbox is not installed",
        )
    })?;
    let runner_path = validate_installation(&installed)?;
    let key = policy_key(&request);
    let capability = store.update(|state| {
        Ok(state
            .capabilities
            .entry(key)
            .or_insert_with(new_capability_record)
            .clone())
    })?;
    validate_capability_sid(&capability.sid)?;

    let account = if request.network_access {
        &installed.online
    } else {
        &installed.offline
    };
    let encrypted_password = BASE64
        .decode(&account.encrypted_password)
        .map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::NeedsRepair,
                "sandbox account credential is corrupt",
                error,
            )
        })?;
    let password = dpapi::unprotect_string(&encrypted_password)?;
    let acl_lock_path = store.acl_lock_path();
    let exit_code = process::spawn_account_runner(
        process::AccountRunnerContext {
            executable: &runner_path,
            owner_sid: &installed.owner_sid,
            username: &account.username,
            account_sid: &account.sid,
            group_sid: &installed.group_sid,
            password: &password,
            acl_lock_path: &acl_lock_path,
        },
        &request,
        request_path,
        &capability.sid,
    )?;
    Ok(CommandOutput::process_exit(exit_code))
}

pub fn internal_child(
    request_path: &Path,
    capability_sid: &str,
    owner_sid: &str,
) -> Result<CommandOutput, SandboxError> {
    accounts::validate_sid_string(owner_sid)?;
    process::authenticate_internal_child_parent(owner_sid)?;
    validate_capability_sid(capability_sid)?;
    let request = SandboxRunRequest::from_file(request_path)?;
    paths::validate_request_paths(&request, request_path)?;
    fs::remove_file(request_path).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "cannot destroy the sandbox request before starting the restricted shell",
            error,
        )
    })?;
    let exit_code = process::spawn_restricted_shell(&request, capability_sid)?;
    Ok(CommandOutput::process_exit(exit_code))
}

fn current_status() -> SandboxStatus {
    let store = match state_store() {
        Ok(store) => store,
        Err(error) => {
            return status_value(
                SandboxStatusKind::NeedsRepair,
                error.detailed_message(),
                None,
            )
        }
    };
    let installed = match store.read() {
        Ok(Some(state)) => state,
        Ok(None) => {
            return status_value(
                SandboxStatusKind::NotInstalled,
                "Windows native sandbox is not installed",
                None,
            )
        }
        Err(error) => {
            return status_value(
                SandboxStatusKind::NeedsRepair,
                error.detailed_message(),
                None,
            )
        }
    };
    let installed_version = Some(installed.installed_version.clone());
    match validate_installation(&installed) {
        Ok(_) => status_value(SandboxStatusKind::Ready, "", installed_version),
        Err(error) => status_value(
            SandboxStatusKind::NeedsRepair,
            error.detailed_message(),
            installed_version,
        ),
    }
}

fn run_execution_probe(network_access: bool) -> Result<(), SandboxError> {
    let store = state_store()?;
    let workspace = store
        .directory()
        .parent()
        .ok_or_else(|| {
            SandboxError::new(
                SandboxErrorCode::Internal,
                "sandbox state directory has no parent for the execution check",
            )
        })?
        .join("Sandbox Health Check");
    fs::create_dir_all(&workspace).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!(
                "cannot create sandbox execution-check workspace {}",
                workspace.display(),
            ),
            error,
        )
    })?;

    let system_root = env::var_os("SystemRoot")
        .or_else(|| env::var_os("SYSTEMROOT"))
        .ok_or_else(|| {
            SandboxError::new(
                SandboxErrorCode::SpawnFailed,
                "SystemRoot is unavailable; cannot create sandbox execution-check control files",
            )
        })?;
    let system_root = PathBuf::from(system_root);
    let system_directory = system_root.join("System32");
    let whoami_path = system_directory.join("whoami.exe");
    if !whoami_path.is_file() {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            format!(
                "sandbox execution-check command is missing: {}",
                whoami_path.display(),
            ),
        ));
    }
    let control_parent = system_root.join("Temp");
    // The stable workspace reuses one capability ACL. Control files remain in
    // randomized system-temp children and are destroyed after each probe.
    let suffix = format!("{}-{:016x}", std::process::id(), rand::random::<u64>());
    let control_root = control_parent.join(format!("setsuna-sandbox-health-{suffix}"));
    let working_root = control_root.join("work");
    let request_path = control_root.join("sandbox-request.json");
    let marker_name = format!("probe-{suffix}.txt");
    let marker_path = workspace.join(&marker_name);

    let result = (|| {
        fs::create_dir_all(&working_root).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                format!(
                    "cannot create sandbox execution-check control directory {}",
                    control_root.display(),
                ),
                error,
            )
        })?;
        let request = SandboxRunRequest {
            protocol_version: PROTOCOL_VERSION,
            execution_id: format!("health_{suffix}"),
            supervisor_pids: vec![std::process::id()],
            command: format!("\"{}\">{marker_name}", whoami_path.display()),
            cwd: workspace.clone(),
            workspace_root: workspace.clone(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            // Match real exec_command plans, which grant the resolved native
            // executable and its containing directory before process launch.
            readable_roots: vec![workspace.clone(), whoami_path.clone(), system_directory],
            writable_roots: vec![workspace.clone(), working_root.clone()],
            ephemeral_writable_roots: vec![working_root.clone()],
            denied_roots: Vec::new(),
            denied_glob_reg_exp_sources: Vec::new(),
            protected_writable_roots: Vec::new(),
            network_access,
            environment: BTreeMap::from([(
                "SystemRoot".to_string(),
                system_root.to_string_lossy().into_owned(),
            )]),
        };
        let request_json = serde_json::to_vec(&request).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::Internal,
                "cannot serialize sandbox execution-check request",
                error,
            )
        })?;
        fs::write(&request_path, request_json).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                format!(
                    "cannot write sandbox execution-check request {}",
                    request_path.display(),
                ),
                error,
            )
        })?;

        let output = run(&request_path)?;
        if output.exit_code != 0 {
            return Err(SandboxError::new(
                SandboxErrorCode::SpawnFailed,
                format!(
                    "sandbox execution-check command exited with code {}",
                    output.exit_code,
                ),
            ));
        }
        let marker = fs::read(&marker_path).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                format!(
                    "sandbox execution-check command did not create {}",
                    marker_path.display(),
                ),
                error,
            )
        })?;
        let expected_username = if network_access {
            ONLINE_USERNAME
        } else {
            OFFLINE_USERNAME
        };
        let identity = String::from_utf8_lossy(&marker).trim().to_ascii_lowercase();
        if !identity.ends_with(&format!("\\{}", expected_username.to_ascii_lowercase())) {
            return Err(SandboxError::new(
                SandboxErrorCode::SpawnFailed,
                format!("sandbox execution-check command returned unexpected identity: {identity}",),
            ));
        }
        Ok(())
    })();

    let _ = fs::remove_file(&marker_path);
    let _ = fs::remove_dir_all(&control_root);
    result
}

fn validate_installation(state: &InstalledState) -> Result<PathBuf, SandboxError> {
    state.validate()?;
    accounts::verify_account(OFFLINE_USERNAME, &state.offline.sid)?;
    accounts::verify_account(ONLINE_USERNAME, &state.online.sid)?;
    accounts::verify_account(SANDBOX_GROUP, &state.group_sid)?;
    accounts::verify_managed_identities()?;
    accounts::verify_group_membership(OFFLINE_USERNAME, SANDBOX_GROUP)?;
    accounts::verify_group_membership(ONLINE_USERNAME, SANDBOX_GROUP)?;
    visibility::verify_hidden(&[OFFLINE_USERNAME, ONLINE_USERNAME])?;
    let store = state_store()?;
    let state_path = store.state_path();
    let lock_path = store.lock_path();
    let acl_lock_path = store.acl_lock_path();
    let lifecycle_path = store.lifecycle_path();
    for path in [
        store.directory(),
        state_path.as_path(),
        lock_path.as_path(),
        acl_lock_path.as_path(),
        lifecycle_path.as_path(),
    ] {
        acl::verify_state_path(path, &state.group_sid)?;
    }
    firewall::verify(
        &state.offline.sid,
        &state.online.sid,
        state.proxy_port_start,
        state.proxy_port_end,
    )?;
    wfp::verify(
        &state.offline.sid,
        &state.online.sid,
        state.proxy_port_start,
        state.proxy_port_end,
    )?;
    bootstrap::verify(&store, state)
}

fn status_value(
    state: SandboxStatusKind,
    reason: impl Into<String>,
    installed_version: Option<String>,
) -> SandboxStatus {
    SandboxStatus {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        sidecar_version: SIDECAR_VERSION.to_string(),
        platform: "windows".to_string(),
        state,
        reason: reason.into(),
        install_supported: true,
        installed_version,
    }
}

fn state_store() -> Result<StateStore, SandboxError> {
    let program_data = env::var_os("ProgramData").ok_or_else(|| {
        SandboxError::new(
            SandboxErrorCode::Internal,
            "ProgramData is unavailable; cannot resolve sandbox state",
        )
    })?;
    let root = PathBuf::from(program_data);
    if !root.is_absolute() {
        return Err(SandboxError::new(
            SandboxErrorCode::Internal,
            "ProgramData must be an absolute path",
        ));
    }
    Ok(StateStore::new(
        root.join("Setsuna Desktop").join("Sandbox"),
    ))
}
