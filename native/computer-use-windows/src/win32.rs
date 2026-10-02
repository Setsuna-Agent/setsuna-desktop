use crate::protocol::{Failure, Result};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

pub struct Handle(pub HANDLE);
impl Handle {
    pub fn new(raw: HANDLE) -> Result<Self> {
        if raw == 0 || raw == INVALID_HANDLE_VALUE {
            Err(Failure::system("Opening Windows handle failed"))
        } else {
            Ok(Self(raw))
        }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

pub fn integrity(pid: Option<u32>) -> Result<u32> {
    let process = pid
        .map(|pid| Handle::new(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) }))
        .transpose()?;
    let mut token = 0;
    if unsafe {
        OpenProcessToken(
            process
                .as_ref()
                .map_or_else(|| GetCurrentProcess(), |p| p.0),
            TOKEN_QUERY,
            &mut token,
        )
    } == 0
    {
        return Err(Failure::system("Reading input target integrity failed"));
    }
    let token = Handle::new(token)?;
    let mut size = 0;
    unsafe {
        GetTokenInformation(
            token.0,
            TokenIntegrityLevel,
            std::ptr::null_mut(),
            0,
            &mut size,
        );
    }
    // Allocate aligned storage for TOKEN_MANDATORY_LABEL and its trailing SID.
    let mut storage = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            token.0,
            TokenIntegrityLevel,
            storage.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    } == 0
    {
        return Err(Failure::system("Reading input target integrity failed"));
    }
    let label = unsafe { &*storage.as_ptr().cast::<TOKEN_MANDATORY_LABEL>() };
    let count = unsafe { *GetSidSubAuthorityCount(label.Label.Sid) };
    if count == 0 {
        return Err(Failure::new(
            "native-failed",
            "Invalid process integrity SID.",
        ));
    }
    Ok(unsafe { *GetSidSubAuthority(label.Label.Sid, u32::from(count - 1)) })
}
