use super::handle::OwnedHandle;
use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{GetLastError, LocalFree, ERROR_SUCCESS, HLOCAL, LUID};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSidToSidW, SetEntriesInAclW, EXPLICIT_ACCESS_W,
    GRANT_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AdjustTokenPrivileges, CopySid, CreateRestrictedToken, DuplicateToken, GetLengthSid,
    GetTokenInformation, LookupPrivilegeValueW, SecurityImpersonation, SetTokenInformation,
    TokenDefaultDacl, TokenGroups, TokenUser, ACL, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED,
    SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_ADJUST_PRIVILEGES, TOKEN_ADJUST_SESSIONID,
    TOKEN_ASSIGN_PRIMARY, TOKEN_DEFAULT_DACL, TOKEN_DUPLICATE, TOKEN_PRIVILEGES, TOKEN_QUERY,
    TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

const DISABLE_MAX_PRIVILEGE: u32 = 0x01;
const LUA_TOKEN: u32 = 0x04;
const WRITE_RESTRICTED: u32 = 0x08;
const GENERIC_ALL: u32 = 0x1000_0000;
const SE_GROUP_LOGON_ID: u32 = 0xC000_0000;

struct LocalSid(*mut c_void);

impl LocalSid {
    fn parse(value: &str) -> Result<Self, SandboxError> {
        let wide = to_wide(value);
        let mut sid = std::ptr::null_mut();
        if unsafe { ConvertStringSidToSidW(wide.as_ptr(), &mut sid) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                format!("cannot parse sandbox SID: {value}"),
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self(sid))
    }
}

impl Drop for LocalSid {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0 as HLOCAL) };
        }
    }
}

pub fn create_restricted_token(capability_sid: &str) -> Result<OwnedHandle, SandboxError> {
    let base = current_process_token()?;
    let capability = LocalSid::parse(capability_sid)?;
    let everyone = LocalSid::parse("S-1-1-0")?;
    let mut user_sid = token_user_sid_bytes(base.raw())?;
    let mut logon_sid = logon_sid_bytes(base.raw())?;

    // Keep the upstream Codex ordering. World is required for core Windows
    // objects (including Winsock startup and NUL), while the dedicated account
    // remains the first access-check boundary and capabilities authorize roots.
    let restricting_sids = [
        SID_AND_ATTRIBUTES {
            Sid: capability.0,
            Attributes: 0,
        },
        SID_AND_ATTRIBUTES {
            Sid: user_sid.as_mut_ptr().cast::<c_void>(),
            Attributes: 0,
        },
        SID_AND_ATTRIBUTES {
            Sid: logon_sid.as_mut_ptr().cast::<c_void>(),
            Attributes: 0,
        },
        SID_AND_ATTRIBUTES {
            Sid: everyone.0,
            Attributes: 0,
        },
    ];
    let mut token = 0;
    let created = unsafe {
        CreateRestrictedToken(
            base.raw(),
            DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            restricting_sids.len() as u32,
            restricting_sids.as_ptr(),
            &mut token,
        )
    };
    if created == 0 {
        let source = std::io::Error::last_os_error();
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!("CreateRestrictedToken failed: {source}"),
            source,
        ));
    }
    let token = OwnedHandle::new(token).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "CreateRestrictedToken returned an invalid token",
            error,
        )
    })?;
    // Match upstream's permissive default DACL: some Windows pipeline and
    // native-runtime IPC cannot initialize with only execution-scoped SIDs.
    // Callers that need cross-account isolation must use an explicit DACL.
    set_default_dacl(
        token.raw(),
        &[logon_sid.as_mut_ptr().cast(), everyone.0, capability.0],
    )?;
    enable_privilege(token.raw(), "SeChangeNotifyPrivilege")?;
    Ok(token)
}

pub fn process_logon_sid(process: isize) -> Result<String, SandboxError> {
    let token = open_process_token(process, TOKEN_QUERY)?;
    let mut sid = logon_sid_bytes(token.raw())?;
    sid_bytes_to_string(&mut sid, "sandbox runner logon SID")
}

pub fn process_user_sid(process: isize) -> Result<String, SandboxError> {
    let token = open_process_token(process, TOKEN_QUERY)?;
    let mut sid = token_user_sid_bytes(token.raw())?;
    sid_bytes_to_string(&mut sid, "process user SID")
}

fn sid_bytes_to_string(sid: &mut [u8], label: &str) -> Result<String, SandboxError> {
    let mut value = std::ptr::null_mut::<u16>();
    if unsafe { ConvertSidToStringSidW(sid.as_mut_ptr().cast::<c_void>(), &mut value) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!("cannot serialize {label}"),
            std::io::Error::last_os_error(),
        ));
    }
    let length = (0..)
        .take_while(|index| unsafe { *value.add(*index) } != 0)
        .count();
    let result =
        String::from_utf16(unsafe { std::slice::from_raw_parts(value, length) }).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::SpawnFailed,
                format!("{label} is not Unicode"),
                error,
            )
        });
    unsafe { LocalFree(value as HLOCAL) };
    result
}

pub fn process_impersonation_token(process: isize) -> Result<OwnedHandle, SandboxError> {
    let primary = open_process_token(process, TOKEN_QUERY | TOKEN_DUPLICATE)?;
    let mut impersonation = 0;
    if unsafe { DuplicateToken(primary.raw(), SecurityImpersonation, &mut impersonation) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "cannot duplicate the sandbox runner token for access checks",
            std::io::Error::last_os_error(),
        ));
    }
    OwnedHandle::new(impersonation).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "sandbox runner returned an invalid impersonation token",
            error,
        )
    })
}

fn open_process_token(process: isize, desired_access: u32) -> Result<OwnedHandle, SandboxError> {
    let mut token = 0;
    if unsafe { OpenProcessToken(process, desired_access, &mut token) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "cannot inspect the sandbox runner token",
            std::io::Error::last_os_error(),
        ));
    }
    OwnedHandle::new(token).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "sandbox runner returned an invalid token handle",
            error,
        )
    })
}

fn current_process_token() -> Result<OwnedHandle, SandboxError> {
    let desired = TOKEN_DUPLICATE
        | TOKEN_QUERY
        | TOKEN_ASSIGN_PRIMARY
        | TOKEN_ADJUST_DEFAULT
        | TOKEN_ADJUST_SESSIONID
        | TOKEN_ADJUST_PRIVILEGES;
    let mut token = 0;
    if unsafe { OpenProcessToken(GetCurrentProcess(), desired, &mut token) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "OpenProcessToken failed in sandbox child",
            std::io::Error::last_os_error(),
        ));
    }
    OwnedHandle::new(token).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "OpenProcessToken returned an invalid token handle",
            error,
        )
    })
}

fn token_user_sid_bytes(token: isize) -> Result<Vec<u8>, SandboxError> {
    let mut required = 0_u32;
    unsafe {
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut required);
    }
    if required == 0 {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            "sandbox account token has no user data",
        ));
    }
    let mut buffer = vec![0_u8; required as usize];
    if unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast::<c_void>(),
            required,
            &mut required,
        )
    } == 0
    {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "GetTokenInformation(TokenUser) failed",
            std::io::Error::last_os_error(),
        ));
    }
    let user = unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<TOKEN_USER>()) };
    copy_sid_bytes(user.User.Sid, "sandbox account user SID")
}

fn logon_sid_bytes(token: isize) -> Result<Vec<u8>, SandboxError> {
    let mut required = 0_u32;
    unsafe {
        GetTokenInformation(token, TokenGroups, std::ptr::null_mut(), 0, &mut required);
    }
    if required == 0 {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            "sandbox account token has no group data",
        ));
    }
    let mut buffer = vec![0_u8; required as usize];
    if unsafe {
        GetTokenInformation(
            token,
            TokenGroups,
            buffer.as_mut_ptr().cast::<c_void>(),
            required,
            &mut required,
        )
    } == 0
    {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "GetTokenInformation(TokenGroups) failed",
            std::io::Error::last_os_error(),
        ));
    }
    let group_count = unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<u32>()) as usize };
    let after_count = unsafe { buffer.as_ptr().add(std::mem::size_of::<u32>()) } as usize;
    let alignment = std::mem::align_of::<SID_AND_ATTRIBUTES>();
    let groups_address = (after_count + alignment - 1) & !(alignment - 1);
    let groups = groups_address as *const SID_AND_ATTRIBUTES;
    for index in 0..group_count {
        let entry = unsafe { std::ptr::read_unaligned(groups.add(index)) };
        if entry.Attributes & SE_GROUP_LOGON_ID == SE_GROUP_LOGON_ID {
            return copy_sid_bytes(entry.Sid, "sandbox logon SID");
        }
    }
    Err(SandboxError::new(
        SandboxErrorCode::SpawnFailed,
        "sandbox account token has no logon SID",
    ))
}

fn copy_sid_bytes(sid: *mut c_void, label: &str) -> Result<Vec<u8>, SandboxError> {
    let length = unsafe { GetLengthSid(sid) };
    if length == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!("cannot measure {label}"),
            std::io::Error::last_os_error(),
        ));
    }
    let mut output = vec![0_u8; length as usize];
    if unsafe { CopySid(length, output.as_mut_ptr().cast::<c_void>(), sid) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!("cannot copy {label}"),
            std::io::Error::last_os_error(),
        ));
    }
    Ok(output)
}

fn set_default_dacl(token: isize, sids: &[*mut c_void]) -> Result<(), SandboxError> {
    let entries = sids
        .iter()
        .map(|sid| EXPLICIT_ACCESS_W {
            grfAccessPermissions: GENERIC_ALL,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: 0,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: std::ptr::null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: sid.cast::<u16>(),
            },
        })
        .collect::<Vec<_>>();
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let merged = unsafe {
        SetEntriesInAclW(
            entries.len() as u32,
            entries.as_ptr(),
            std::ptr::null_mut(),
            &mut dacl,
        )
    };
    if merged != ERROR_SUCCESS {
        return Err(SandboxError::new(
            SandboxErrorCode::SpawnFailed,
            format!("SetEntriesInAclW for token failed: {merged}"),
        ));
    }
    let mut info = TOKEN_DEFAULT_DACL { DefaultDacl: dacl };
    let set = unsafe {
        SetTokenInformation(
            token,
            TokenDefaultDacl,
            std::ptr::addr_of_mut!(info).cast::<c_void>(),
            std::mem::size_of::<TOKEN_DEFAULT_DACL>() as u32,
        )
    };
    unsafe { LocalFree(dacl as HLOCAL) };
    if set == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            "SetTokenInformation(TokenDefaultDacl) failed",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(())
}

fn enable_privilege(token: isize, name: &str) -> Result<(), SandboxError> {
    let mut luid = LUID {
        LowPart: 0,
        HighPart: 0,
    };
    if unsafe { LookupPrivilegeValueW(std::ptr::null(), to_wide(name).as_ptr(), &mut luid) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!("LookupPrivilegeValueW failed for {name}"),
            std::io::Error::last_os_error(),
        ));
    }
    let privileges = TOKEN_PRIVILEGES {
        PrivilegeCount: 1,
        Privileges: [LUID_AND_ATTRIBUTES {
            Luid: luid,
            Attributes: SE_PRIVILEGE_ENABLED,
        }],
    };
    unsafe { windows_sys::Win32::Foundation::SetLastError(ERROR_SUCCESS) };
    if unsafe {
        AdjustTokenPrivileges(
            token,
            0,
            &privileges,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
        || unsafe { GetLastError() } != ERROR_SUCCESS
    {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SpawnFailed,
            format!("AdjustTokenPrivileges failed for {name}"),
            std::io::Error::last_os_error(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_write_restricted_token() {
        create_restricted_token("S-1-5-21-101010101-202020202-303030303-404040404")
            .expect("write-restricted token");
    }
}
