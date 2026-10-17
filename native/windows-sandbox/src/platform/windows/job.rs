use super::handle::OwnedHandle;
use crate::protocol::{SandboxError, SandboxErrorCode};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
    JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    DeleteProcThreadAttributeList, InitializeProcThreadAttributeList, UpdateProcThreadAttribute,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, STARTUPINFOEXW,
};

#[cfg(test)]
#[path = "../../../test/job-creation.rs"]
mod creation_tests;

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
        let mut member = 0;
        if unsafe { IsProcessInJob(process, self.handle.raw(), &mut member) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                "IsProcessInJob failed",
                std::io::Error::last_os_error(),
            ));
        }
        if member != 0 {
            return Ok(());
        }
        if unsafe { AssignProcessToJobObject(self.handle.raw(), process) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                "AssignProcessToJobObject failed",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(())
    }

    pub fn process_attributes(&self) -> Result<JobProcessAttributes<'_>, SandboxError> {
        JobProcessAttributes::new(self)
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

    pub fn active_processes(&self) -> Result<u32, SandboxError> {
        let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe {
            QueryInformationJobObject(
                self.handle.raw(),
                JobObjectBasicAccountingInformation,
                std::ptr::addr_of_mut!(accounting).cast::<c_void>(),
                std::mem::size_of_val(&accounting) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                "QueryInformationJobObject failed",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(accounting.ActiveProcesses)
    }
}

/// Assign at creation time: suspending first is not enough if the launcher is
/// killed between CreateProcess and AssignProcessToJobObject.
pub struct JobProcessAttributes<'job> {
    storage: Vec<usize>,
    handles: Box<[HANDLE; 1]>,
    _job: &'job JobObject,
}

impl<'job> JobProcessAttributes<'job> {
    fn new(job: &'job JobObject) -> Result<Self, SandboxError> {
        let mut size = 0;
        unsafe {
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut size);
        }
        if size == 0 {
            return Err(attribute_error("cannot size process attribute list"));
        }
        // Pointer-sized storage keeps the opaque attribute list correctly aligned.
        let mut storage = vec![0_usize; size.div_ceil(std::mem::size_of::<usize>())];
        let pointer = storage.as_mut_ptr().cast::<c_void>();
        if unsafe { InitializeProcThreadAttributeList(pointer, 1, 0, &mut size) } == 0 {
            return Err(attribute_error("cannot initialize process attribute list"));
        }
        let attributes = Self {
            storage,
            handles: Box::new([job.handle.raw()]),
            _job: job,
        };
        if unsafe {
            UpdateProcThreadAttribute(
                attributes.pointer(),
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                attributes.handles.as_ptr().cast::<c_void>(),
                std::mem::size_of::<HANDLE>(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        } == 0
        {
            return Err(attribute_error("cannot bind Job to process creation"));
        }
        Ok(attributes)
    }

    fn pointer(&self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.storage.as_ptr().cast_mut().cast::<c_void>()
    }

    pub fn startup_info(&self) -> STARTUPINFOEXW {
        let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.lpAttributeList = self.pointer();
        startup
    }
}

impl Drop for JobProcessAttributes<'_> {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.pointer());
        }
    }
}

fn attribute_error(message: &str) -> SandboxError {
    SandboxError::with_source(
        SandboxErrorCode::SpawnFailed,
        message,
        std::io::Error::last_os_error(),
    )
}
