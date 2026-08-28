use super::handle::OwnedHandle;
use super::job::JobObject;
use super::token::{
    create_restricted_token, process_impersonation_token, process_logon_sid, process_user_sid,
};
use super::wide::{quote_windows_argument, to_wide};
use crate::protocol::{SandboxError, SandboxErrorCode, SandboxRunRequest};
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{
    SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_FAILED,
    WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::Diagnostics::Debug::{
    SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::StationsAndDesktops::{
    CloseDesktop, CreateDesktopW, DESKTOP_CREATEWINDOW, DESKTOP_ENUMERATE, DESKTOP_READOBJECTS,
    DESKTOP_WRITEOBJECTS, HDESK,
};
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, CreateProcessWithLogonW, GetCurrentProcess, GetCurrentProcessId,
    GetExitCodeProcess, OpenProcess, ResumeThread, TerminateProcess, WaitForMultipleObjects,
    WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, INFINITE,
    PROCESS_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    STARTF_USESHOWWINDOW, STARTF_USESTDHANDLES, STARTUPINFOW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
use zeroize::{Zeroize, Zeroizing};

pub struct AccountRunnerContext<'a> {
    pub executable: &'a Path,
    pub owner_sid: &'a str,
    pub username: &'a str,
    pub account_sid: &'a str,
    pub group_sid: &'a str,
    pub password: &'a Zeroizing<String>,
    pub acl_lock_path: &'a Path,
}

pub fn spawn_account_runner(
    context: AccountRunnerContext<'_>,
    request: &SandboxRunRequest,
    request_path: &Path,
    capability_sid: &str,
) -> Result<i32, SandboxError> {
    let supervisors = open_supervisors(&request.supervisor_pids)?;
    let _request_acl = super::acl::prepare_request_bootstrap(
        request_path,
        context.account_sid,
        context.acl_lock_path,
    )?;
    let arguments = [
        "internal-child".to_string(),
        "--request".to_string(),
        request_path.to_string_lossy().into_owned(),
        "--capability-sid".to_string(),
        capability_sid.to_string(),
        "--owner-sid".to_string(),
        context.owner_sid.to_string(),
    ];
    let command_line = std::iter::once(context.executable.to_string_lossy().into_owned())
        .chain(arguments)
        .map(|argument| quote_windows_argument(&argument))
        .collect::<Vec<_>>()
        .join(" ");
    let mut command_line_wide = to_wide(command_line);
    let executable_wide = to_wide(context.executable.as_os_str());
    let username_wide = to_wide(context.username);
    let domain_wide = to_wide(".");
    let mut password_wide = to_wide(context.password.as_str());
    let cwd = request_path.parent().ok_or_else(|| {
        SandboxError::new(
            SandboxErrorCode::InvalidRequest,
            "sandbox request file has no parent directory",
        )
    })?;
    let cwd_wide = to_wide(cwd.as_os_str());
    let (stdin, stdout, stderr) = inheritable_standard_handles()?;
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    startup.wShowWindow = SW_HIDE as u16;
    startup.hStdInput = stdin;
    startup.hStdOutput = stdout;
    startup.hStdError = stderr;
    let mut process_info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let job = JobObject::create()?;
    let created = unsafe {
        CreateProcessWithLogonW(
            username_wide.as_ptr(),
            domain_wide.as_ptr(),
            password_wide.as_ptr(),
            0,
            executable_wide.as_ptr(),
            command_line_wide.as_mut_ptr(),
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            std::ptr::null::<c_void>(),
            cwd_wide.as_ptr(),
            &startup,
            &mut process_info,
        )
    };
    password_wide.zeroize();
    if created == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!("CreateProcessWithLogonW failed for {}", context.username),
            std::io::Error::last_os_error(),
        ));
    }
    let process = OwnedHandle::new(process_info.hProcess).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "process creation returned an invalid process handle",
            error,
        )
    })?;
    let thread = OwnedHandle::new(process_info.hThread).map_err(|error| {
        unsafe {
            TerminateProcess(process.raw(), 1);
        }
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "process creation returned an invalid thread handle",
            error,
        )
    })?;
    let execution_acl = process_logon_sid(process.raw()).and_then(|logon_sid| {
        let access_token = process_impersonation_token(process.raw())?;
        super::acl::prepare_execution(
            request,
            &logon_sid,
            access_token.raw(),
            context.group_sid,
            capability_sid,
            context.acl_lock_path,
        )
    });
    let _execution_acl = match execution_acl {
        Ok(grant) => grant,
        Err(error) => {
            unsafe {
                TerminateProcess(process.raw(), 1);
            }
            return Err(error);
        }
    };
    wait_for_contained_process(process, thread, &job, &supervisors)
}

/// `internal-child` is intentionally not a public protocol entrypoint. The
/// trusted launcher crosses from the desktop account into a dedicated sandbox
/// account; a nested call made by sandboxed code has the same account on both
/// sides and is rejected before it can supply another capability SID.
pub fn authenticate_internal_child_parent(expected_parent_sid: &str) -> Result<(), SandboxError> {
    let current_sid = process_user_sid(unsafe { GetCurrentProcess() })?;
    let parent_pid = current_parent_process_id()?;
    let parent =
        OwnedHandle::new(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, parent_pid) })
            .map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::InvalidArguments,
                    "cannot inspect the internal-child parent process",
                    error,
                )
            })?;
    let parent_sid = process_user_sid(parent.raw())?;
    validate_internal_child_accounts(&current_sid, &parent_sid, expected_parent_sid)
}

fn validate_internal_child_accounts(
    current_sid: &str,
    parent_sid: &str,
    expected_parent_sid: &str,
) -> Result<(), SandboxError> {
    if current_sid.eq_ignore_ascii_case(expected_parent_sid)
        || !parent_sid.eq_ignore_ascii_case(expected_parent_sid)
    {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            "internal-child requires the trusted cross-account launcher",
        ));
    }
    Ok(())
}

fn current_parent_process_id() -> Result<u32, SandboxError> {
    let snapshot = OwnedHandle::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })
        .map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::InvalidArguments,
                "cannot enumerate processes for internal-child authentication",
                error,
            )
        })?;
    let current_pid = unsafe { GetCurrentProcessId() };
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut found = unsafe { Process32FirstW(snapshot.raw(), &mut entry) } != 0;
    while found {
        if entry.th32ProcessID == current_pid && entry.th32ParentProcessID != 0 {
            return Ok(entry.th32ParentProcessID);
        }
        found = unsafe { Process32NextW(snapshot.raw(), &mut entry) } != 0;
    }
    Err(SandboxError::new(
        SandboxErrorCode::InvalidArguments,
        "cannot resolve the internal-child parent process",
    ))
}

pub fn spawn_restricted_shell(
    request: &SandboxRunRequest,
    capability_sid: &str,
) -> Result<i32, SandboxError> {
    // Tool failures must surface through exit codes instead of modal Windows dialogs.
    unsafe {
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    }
    let token = create_restricted_token(capability_sid)?;
    let command_processor = system_command_processor()?;
    let command_line = format!(
        "{} /d /s /c \"{}\"",
        quote_windows_argument(&command_processor.to_string_lossy()),
        request.command
    );
    let mut command_line_wide = to_wide(command_line);
    let command_processor_wide = to_wide(command_processor.as_os_str());
    let cwd_wide = to_wide(request.cwd.as_os_str());
    let mut environment = request.environment.clone();
    harden_environment(&mut environment, request.network_access);
    let environment_block = environment_block(&environment);
    let (stdin, stdout, stderr) = inheritable_standard_handles()?;
    // Keep every window created by cmd and its descendants off the interactive
    // desktop. Package managers can spawn console processes without inheriting
    // our CREATE_NO_WINDOW flag, but their windows remain on this hidden desktop.
    let (_desktop, mut desktop_wide) = create_execution_desktop()?;
    // Node resolves pnpm's Junction-based dependency tree through FSCTL-backed
    // lstat/realpath calls. Write containment comes from WRITE_RESTRICTED plus
    // per-root capability ACLs, so disabling every FSCTL would only break reads.
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    startup.wShowWindow = SW_HIDE as u16;
    startup.hStdInput = stdin;
    startup.hStdOutput = stdout;
    startup.hStdError = stderr;
    startup.lpDesktop = desktop_wide.as_mut_ptr();
    let mut process_info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let created = unsafe {
        CreateProcessAsUserW(
            token.raw(),
            command_processor_wide.as_ptr(),
            command_line_wide.as_mut_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            1,
            CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            environment_block.as_ptr().cast::<c_void>(),
            cwd_wide.as_ptr(),
            &startup,
            &mut process_info,
        )
    };
    if created == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "CreateProcessAsUserW failed for restricted shell",
            std::io::Error::last_os_error(),
        ));
    }
    wait_for_process(process_info)
}

struct OwnedDesktop(HDESK);

impl Drop for OwnedDesktop {
    fn drop(&mut self) {
        unsafe {
            CloseDesktop(self.0);
        }
    }
}

fn create_execution_desktop() -> Result<(OwnedDesktop, Vec<u16>), SandboxError> {
    let name = format!("SetsunaSandbox-{}", unsafe { GetCurrentProcessId() });
    let name_wide = to_wide(&name);
    let desktop = unsafe {
        CreateDesktopW(
            name_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            DESKTOP_CREATEWINDOW | DESKTOP_ENUMERATE | DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS,
            std::ptr::null(),
        )
    };
    if desktop == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "cannot create hidden desktop for sandboxed command",
            std::io::Error::last_os_error(),
        ));
    }
    Ok((OwnedDesktop(desktop), to_wide(format!("winsta0\\{name}"))))
}

fn wait_for_contained_process(
    process: OwnedHandle,
    thread: OwnedHandle,
    job: &JobObject,
    supervisors: &[OwnedHandle],
) -> Result<i32, SandboxError> {
    if let Err(error) = job.assign(process.raw()) {
        unsafe {
            TerminateProcess(process.raw(), 1);
        }
        return Err(error);
    }
    if unsafe { ResumeThread(thread.raw()) } == u32::MAX {
        unsafe {
            TerminateProcess(process.raw(), 1);
        }
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "ResumeThread failed for sandbox runner",
            std::io::Error::last_os_error(),
        ));
    }
    let handles = std::iter::once(process.raw())
        .chain(supervisors.iter().map(OwnedHandle::raw))
        .collect::<Vec<_>>();
    let wait =
        unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE) };
    if wait == WAIT_FAILED {
        job.terminate(1)?;
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "WaitForMultipleObjects failed for sandbox supervision",
            std::io::Error::last_os_error(),
        ));
    }
    if wait != WAIT_OBJECT_0 {
        job.terminate(1)?;
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            "sandbox supervisor exited; the contained process tree was terminated",
        ));
    }
    wait_for_owned_process(process)
}

fn open_supervisors(pids: &[u32]) -> Result<Vec<OwnedHandle>, SandboxError> {
    pids.iter()
        .map(|pid| {
            let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, *pid) };
            OwnedHandle::new(handle).map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::SpawnFailed,
                    format!("cannot monitor sandbox supervisor process {pid}"),
                    error,
                )
            })
        })
        .collect()
}

fn wait_for_process(process_info: PROCESS_INFORMATION) -> Result<i32, SandboxError> {
    let process = OwnedHandle::new(process_info.hProcess).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "shell creation returned an invalid process handle",
            error,
        )
    })?;
    let _thread = OwnedHandle::new(process_info.hThread).map_err(|error| {
        unsafe {
            TerminateProcess(process.raw(), 1);
        }
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "shell creation returned an invalid thread handle",
            error,
        )
    })?;
    wait_for_owned_process(process)
}

fn wait_for_owned_process(process: OwnedHandle) -> Result<i32, SandboxError> {
    let wait = unsafe { WaitForSingleObject(process.raw(), INFINITE) };
    if wait == u32::MAX {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "WaitForSingleObject failed for sandbox process",
            std::io::Error::last_os_error(),
        ));
    }
    let mut exit_code = 0_u32;
    if unsafe { GetExitCodeProcess(process.raw(), &mut exit_code) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "GetExitCodeProcess failed for sandbox process",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(exit_code as i32)
}

fn inheritable_standard_handles() -> Result<(HANDLE, HANDLE, HANDLE), SandboxError> {
    let handles = unsafe {
        (
            GetStdHandle(STD_INPUT_HANDLE),
            GetStdHandle(STD_OUTPUT_HANDLE),
            GetStdHandle(STD_ERROR_HANDLE),
        )
    };
    for handle in [handles.0, handles.1, handles.2] {
        if handle == 0 || handle == INVALID_HANDLE_VALUE {
            return Err(SandboxError::new(
                SandboxErrorCode::SpawnFailed,
                "sandbox sidecar requires valid stdin, stdout, and stderr handles",
            ));
        }
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                "cannot mark sandbox stdio handle inheritable",
                std::io::Error::last_os_error(),
            ));
        }
    }
    Ok(handles)
}

fn system_command_processor() -> Result<PathBuf, SandboxError> {
    let mut buffer = vec![0_u16; 32_768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
    if length == 0 || length as usize >= buffer.len() {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "GetSystemDirectoryW failed",
            std::io::Error::last_os_error(),
        ));
    }
    let directory = String::from_utf16(&buffer[..length as usize]).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "Windows system directory is not Unicode",
            error,
        )
    })?;
    let command_processor = PathBuf::from(directory).join("cmd.exe");
    if !command_processor.is_file() {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            format!(
                "trusted Windows command processor is missing: {}",
                command_processor.display()
            ),
        ));
    }
    Ok(command_processor)
}

fn harden_environment(environment: &mut BTreeMap<String, String>, network_access: bool) {
    for key in [
        "SETSUNA_DESKTOP_NATIVE_BRIDGE_TOKEN",
        "SETSUNA_DESKTOP_RUNTIME_TOKEN",
        "SETSUNA_DESKTOP_HOST_PID",
        "SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH",
        "ELECTRON_RUN_AS_NODE",
        "__COMPAT_LAYER",
    ] {
        remove_environment_key(environment, key);
    }
    set_environment_key(environment, "SETSUNA_WINDOWS_SANDBOX", "1");
    set_environment_key(
        environment,
        "SETSUNA_WINDOWS_SANDBOX_NETWORK",
        if network_access { "proxy" } else { "offline" },
    );
    if !network_access {
        for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
            remove_environment_key(environment, key);
        }
    }
    // Loopback bypass would let online commands reach arbitrary host services.
    // The dedicated egress proxy is itself selected explicitly by proxy vars.
    set_environment_key(environment, "NO_PROXY", "");
}

fn remove_environment_key(environment: &mut BTreeMap<String, String>, requested: &str) {
    let matching_keys = environment
        .keys()
        .filter(|key| key.eq_ignore_ascii_case(requested))
        .cloned()
        .collect::<Vec<_>>();
    for key in matching_keys {
        environment.remove(&key);
    }
}

fn set_environment_key(environment: &mut BTreeMap<String, String>, key: &str, value: &str) {
    remove_environment_key(environment, key);
    environment.insert(key.to_string(), value.to_string());
}

fn environment_block(environment: &BTreeMap<String, String>) -> Vec<u16> {
    let mut entries = environment.iter().collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.0.to_lowercase());
    let mut block = Vec::new();
    for (key, value) in entries {
        block.extend(format!("{key}={value}").encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn online_environment_uses_one_canonical_entry_per_windows_key() {
        let mut environment = BTreeMap::from([
            (
                "HTTP_PROXY".to_string(),
                "http://127.0.0.1:61080".to_string(),
            ),
            (
                "HTTPS_PROXY".to_string(),
                "http://127.0.0.1:61080".to_string(),
            ),
            (
                "ALL_PROXY".to_string(),
                "http://127.0.0.1:61080".to_string(),
            ),
            ("no_proxy".to_string(), "localhost".to_string()),
            ("setsuna_windows_sandbox".to_string(), "stale".to_string()),
        ]);

        harden_environment(&mut environment, true);

        assert_eq!(
            environment
                .get("SETSUNA_WINDOWS_SANDBOX")
                .map(String::as_str),
            Some("1")
        );
        assert_eq!(
            environment
                .get("SETSUNA_WINDOWS_SANDBOX_NETWORK")
                .map(String::as_str),
            Some("proxy")
        );
        assert_eq!(environment.get("NO_PROXY").map(String::as_str), Some(""));
        assert!(!environment.contains_key("no_proxy"));
        assert_case_insensitive_keys_are_unique(&environment);
    }

    #[test]
    fn offline_environment_removes_proxy_entries_regardless_of_case() {
        let mut environment = BTreeMap::from([
            (
                "http_proxy".to_string(),
                "http://127.0.0.1:61080".to_string(),
            ),
            (
                "Https_Proxy".to_string(),
                "http://127.0.0.1:61080".to_string(),
            ),
            (
                "ALL_PROXY".to_string(),
                "http://127.0.0.1:61080".to_string(),
            ),
            ("No_Proxy".to_string(), "localhost".to_string()),
        ]);

        harden_environment(&mut environment, false);

        for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
            assert!(!environment
                .keys()
                .any(|candidate| candidate.eq_ignore_ascii_case(key)));
        }
        assert_eq!(environment.get("NO_PROXY").map(String::as_str), Some(""));
        assert_eq!(
            environment
                .get("SETSUNA_WINDOWS_SANDBOX_NETWORK")
                .map(String::as_str),
            Some("offline")
        );
        assert_case_insensitive_keys_are_unique(&environment);
    }

    fn assert_case_insensitive_keys_are_unique(environment: &BTreeMap<String, String>) {
        let mut keys = HashSet::new();
        for key in environment.keys() {
            assert!(
                keys.insert(key.to_ascii_uppercase()),
                "duplicate environment key: {key}"
            );
        }
    }
}
