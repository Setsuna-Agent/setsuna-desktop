use super::handle::OwnedHandle;
use super::wide::{quote_windows_argument, to_wide};
use crate::protocol::{SandboxError, SandboxErrorCode};
use windows_sys::Win32::Foundation::{GetLastError, ERROR_CANCELLED, WAIT_FAILED};
use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

pub fn run_elevated(command: &str, arguments: &[&str]) -> Result<(), SandboxError> {
    let executable = std::env::current_exe().map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::Internal,
            "cannot resolve sandbox sidecar executable",
            error,
        )
    })?;
    let mut parameters = vec![quote_windows_argument(command)];
    parameters.extend(
        arguments
            .iter()
            .map(|argument| quote_windows_argument(argument)),
    );
    let parameters = parameters.join(" ");
    let verb_wide = to_wide("runas");
    let executable_wide = to_wide(executable.as_os_str());
    let parameters_wide = to_wide(parameters);
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb_wide.as_ptr();
    info.lpFile = executable_wide.as_ptr();
    info.lpParameters = parameters_wide.as_ptr();
    info.nShow = SW_HIDE;
    let launched = unsafe { ShellExecuteExW(&mut info) };
    if launched == 0 {
        let error = unsafe { GetLastError() };
        return Err(SandboxError::new(
            if error == ERROR_CANCELLED {
                SandboxErrorCode::ElevationCancelled
            } else {
                SandboxErrorCode::SetupFailed
            },
            format!("elevated sandbox command was not started: {error}"),
        ));
    }
    let process = OwnedHandle::new(info.hProcess).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            "ShellExecuteExW returned no process handle",
            error,
        )
    })?;
    if unsafe { WaitForSingleObject(process.raw(), INFINITE) } == WAIT_FAILED {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            "WaitForSingleObject failed for elevated sandbox command",
            std::io::Error::last_os_error(),
        ));
    }
    let mut exit_code = 0_u32;
    if unsafe { GetExitCodeProcess(process.raw(), &mut exit_code) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            "GetExitCodeProcess failed for elevated sandbox command",
            std::io::Error::last_os_error(),
        ));
    }
    if exit_code != 0 {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("elevated sandbox command exited with code {exit_code}"),
        ));
    }
    Ok(())
}
