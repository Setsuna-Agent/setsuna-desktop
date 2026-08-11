use super::handle::OwnedHandle;
use super::job::JobObject;
use super::token::{create_restricted_token, process_logon_sid};
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
use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, CreateProcessWithLogonW, GetExitCodeProcess, OpenProcess, ResumeThread,
    TerminateProcess, WaitForMultipleObjects, WaitForSingleObject, CREATE_SUSPENDED,
    CREATE_UNICODE_ENVIRONMENT, INFINITE, PROCESS_INFORMATION, PROCESS_SYNCHRONIZE,
    STARTF_USESTDHANDLES, STARTUPINFOW,
};
use zeroize::{Zeroize, Zeroizing};

pub struct AccountRunnerContext<'a> {
    pub executable: &'a Path,
    pub username: &'a str,
    pub account_sid: &'a str,
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
    startup.dwFlags = STARTF_USESTDHANDLES;
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
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
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
        super::acl::prepare_execution(request, &logon_sid, capability_sid, context.acl_lock_path)
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

pub fn spawn_restricted_shell(
    request: &SandboxRunRequest,
    capability_sid: &str,
) -> Result<i32, SandboxError> {
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
    let mut desktop_wide = to_wide("winsta0\\default");
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES;
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
            CREATE_UNICODE_ENVIRONMENT,
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
    environment.insert("SETSUNA_WINDOWS_SANDBOX".to_string(), "1".to_string());
    environment.insert(
        "SETSUNA_WINDOWS_SANDBOX_NETWORK".to_string(),
        if network_access { "proxy" } else { "offline" }.to_string(),
    );
    if !network_access {
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            remove_environment_key(environment, key);
        }
    }
    // Loopback bypass would let online commands reach arbitrary host services.
    // The dedicated egress proxy is itself selected explicitly by proxy vars.
    environment.insert("NO_PROXY".to_string(), String::new());
    environment.insert("no_proxy".to_string(), String::new());
}

fn remove_environment_key(environment: &mut BTreeMap<String, String>, requested: &str) {
    if let Some(key) = environment
        .keys()
        .find(|key| key.eq_ignore_ascii_case(requested))
        .cloned()
    {
        environment.remove(&key);
    }
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
