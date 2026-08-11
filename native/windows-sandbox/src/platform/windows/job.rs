use super::handle::OwnedHandle;
use crate::protocol::{SandboxError, SandboxErrorCode};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct JobObject {
    handle: OwnedHandle,
}

impl JobObject {
    pub fn create() -> Result<Self, SandboxError> {
        let handle =
            OwnedHandle::new(unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) })
                .map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::SpawnFailed,
                    "CreateJobObjectW failed",
                    error,
                )
            })?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle.raw(),
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of_mut!(limits).cast::<c_void>(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                "SetInformationJobObject failed",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self { handle })
    }

    pub fn assign(&self, process: HANDLE) -> Result<(), SandboxError> {
        if unsafe { AssignProcessToJobObject(self.handle.raw(), process) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                "AssignProcessToJobObject failed",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(())
    }

    pub fn terminate(&self, exit_code: u32) -> Result<(), SandboxError> {
        if unsafe { TerminateJobObject(self.handle.raw(), exit_code) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                "TerminateJobObject failed",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(())
    }
}
