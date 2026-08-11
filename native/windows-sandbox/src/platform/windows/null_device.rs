use super::handle::OwnedHandle;
use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HLOCAL};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, EXPLICIT_ACCESS_W,
    SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{ACL, DACL_SECURITY_INFORMATION};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

const SE_KERNEL_OBJECT: i32 = 6;
const READ_CONTROL: u32 = 0x0002_0000;
const WRITE_DAC: u32 = 0x0004_0000;

struct LocalAllocation(*mut c_void);

impl LocalAllocation {
    fn sid(value: &str) -> Result<Self, SandboxError> {
        let mut pointer = std::ptr::null_mut();
        if unsafe { ConvertStringSidToSidW(to_wide(value).as_ptr(), &mut pointer) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::Internal,
                format!("invalid sandbox capability SID: {value}"),
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self(pointer))
    }
}

impl Drop for LocalAllocation {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0 as HLOCAL) };
        }
    }
}

pub fn ensure_access(capability_sid: &str) -> Result<(), SandboxError> {
    let capability = LocalAllocation::sid(capability_sid)?;
    let null_device = to_wide(r"\\.\NUL");
    let handle = OwnedHandle::new(unsafe {
        CreateFileW(
            null_device.as_ptr(),
            READ_CONTROL | WRITE_DAC,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            0,
        )
    })
    .map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "cannot open the Windows NUL device for sandbox authorization",
            error,
        )
    })?;

    let mut descriptor = std::ptr::null_mut();
    let mut old_dacl = std::ptr::null_mut::<ACL>();
    let fetched = unsafe {
        GetSecurityInfo(
            handle.raw(),
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    let _descriptor = LocalAllocation(descriptor);
    if fetched != ERROR_SUCCESS || descriptor.is_null() {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            format!("cannot inspect the Windows NUL device ACL: {fetched}"),
        ));
    }

    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE,
        grfAccessMode: SET_ACCESS,
        grfInheritance: 0,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: capability.0.cast::<u16>(),
        },
    };
    let mut new_dacl = std::ptr::null_mut();
    let merged = unsafe { SetEntriesInAclW(1, &entry, old_dacl, &mut new_dacl) };
    let _new_dacl = LocalAllocation(new_dacl.cast());
    if merged != ERROR_SUCCESS || new_dacl.is_null() {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            format!("cannot construct the Windows NUL device ACL: {merged}"),
        ));
    }

    let applied = unsafe {
        SetSecurityInfo(
            handle.raw(),
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            new_dacl,
            std::ptr::null_mut(),
        )
    };
    if applied != ERROR_SUCCESS {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            format!("cannot authorize the Windows NUL device: {applied}"),
        ));
    }
    Ok(())
}
