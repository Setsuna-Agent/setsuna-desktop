use super::handle::OwnedHandle;
use super::job::JobObject;
use crate::protocol::{validate_supervisor_pids, SandboxError, SandboxErrorCode};
use windows_sys::Win32::Foundation::{WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, ResumeThread, TerminateProcess, WaitForMultipleObjects,
    WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
};

pub fn open_supervisors(pids: &[u32]) -> Result<Vec<OwnedHandle>, SandboxError> {
    validate_supervisor_pids(pids)?;
    pids.iter()
        .map(|pid| {
            OwnedHandle::new(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, *pid) }).map_err(
                |error| {
                    SandboxError::with_source(
                        SandboxErrorCode::SpawnFailed,
                        format!("cannot monitor supervisor process {pid}"),
                        error,
                    )
                },
            )
        })
        .collect()
}

pub fn wait_for_contained_process(
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
    let supervisor_handles = supervisors.iter().map(OwnedHandle::raw).collect::<Vec<_>>();
    // Check the captured owner handles before running any command. Never reopen
    // PIDs after startup: a recycled PID must not become the new owner.
    wait_for_supervisors(&supervisor_handles, 0, job)?;
    if unsafe { ResumeThread(thread.raw()) } == u32::MAX {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "ResumeThread failed for managed process",
            std::io::Error::last_os_error(),
        ));
    }
    // Supervisor handles precede the root so simultaneous owner/root exit still
    // cancels the tree. Until the root exits there is no polling.
    let mut handles = supervisor_handles.clone();
    handles.push(process.raw());
    let wait =
        unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE) };
    if wait != WAIT_OBJECT_0 + supervisor_handles.len() as u32 {
        return supervision_failure(wait, job);
    }
    let root_exit_code = wait_for_owned_process(process)?;
    // A shell may exit after launching a GUI/service. Preserve its exit code,
    // but keep the Job, pipes and resource leases alive until every descendant exits.
    while job.active_processes()? != 0 {
        wait_for_supervisors(&supervisor_handles, 100, job)?;
    }
    Ok(root_exit_code)
}

fn wait_for_supervisors(
    handles: &[windows_sys::Win32::Foundation::HANDLE],
    timeout: u32,
    job: &JobObject,
) -> Result<(), SandboxError> {
    let wait =
        unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, timeout) };
    if wait == WAIT_TIMEOUT {
        return Ok(());
    }
    supervision_failure(wait, job)
}

fn supervision_failure<T>(wait: u32, job: &JobObject) -> Result<T, SandboxError> {
    let error = if wait == WAIT_FAILED {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "WaitForMultipleObjects failed for process supervision",
            std::io::Error::last_os_error(),
        )
    } else {
        SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            "supervisor exited; the contained process tree was terminated",
        )
    };
    job.terminate(1)?;
    Err(error)
}

pub fn wait_for_owned_process(process: OwnedHandle) -> Result<i32, SandboxError> {
    if unsafe { WaitForSingleObject(process.raw(), INFINITE) } == WAIT_FAILED {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "WaitForSingleObject failed for managed process",
            std::io::Error::last_os_error(),
        ));
    }
    let mut exit_code = 0_u32;
    if unsafe { GetExitCodeProcess(process.raw(), &mut exit_code) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "GetExitCodeProcess failed for managed process",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(exit_code as i32)
}
