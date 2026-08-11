use super::handle::OwnedHandle;
use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode};
use crate::state::{OFFLINE_USERNAME, ONLINE_USERNAME, SANDBOX_GROUP};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL;
use base64::Engine;
use rand::{rngs::OsRng, RngCore};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{GetLastError, LocalFree, HLOCAL};
use windows_sys::Win32::NetworkManagement::NetManagement::{
    NERR_Success, NERR_UserExists, NetApiBufferFree, NetLocalGroupAdd, NetLocalGroupAddMembers,
    NetLocalGroupDel, NetLocalGroupGetInfo, NetUserAdd, NetUserDel, NetUserGetInfo,
    NetUserGetLocalGroups, LG_INCLUDE_INDIRECT, LOCALGROUP_INFO_1, LOCALGROUP_MEMBERS_INFO_3,
    LOCALGROUP_USERS_INFO_0, MAX_PREFERRED_LENGTH, UF_ACCOUNTDISABLE, UF_DONT_EXPIRE_PASSWD,
    UF_LOCKOUT, UF_NORMAL_ACCOUNT, UF_NOT_DELEGATED, UF_PASSWORD_EXPIRED, UF_SCRIPT, USER_INFO_1,
    USER_PRIV_USER,
};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{
    CopySid, GetLengthSid, GetTokenInformation, LookupAccountNameW, TokenElevation, TokenUser,
    SID_NAME_USE, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, OpenProcessToken,
};
use zeroize::{Zeroize, Zeroizing};

const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
const NERR_USER_NOT_FOUND: u32 = 2221;
const NERR_GROUP_NOT_FOUND: u32 = 2220;
const ERROR_ALIAS_EXISTS: u32 = 1379;
const NERR_GROUP_EXISTS: u32 = 2223;
const MANAGED_GROUP_COMMENT: &str = "Setsuna Desktop sandbox group (managed; do not reuse)";
const MANAGED_USER_COMMENT: &str = "Setsuna Desktop sandbox account (managed; do not reuse)";
const MANAGED_USER_FLAGS: u32 =
    UF_SCRIPT | UF_DONT_EXPIRE_PASSWD | UF_NORMAL_ACCOUNT | UF_NOT_DELEGATED;
const USERS_GROUP_SID: &str = "S-1-5-32-545";

pub struct ProvisionedAccounts {
    pub group_sid: String,
    pub offline_sid: String,
    pub online_sid: String,
    pub offline_password: Zeroizing<String>,
    pub online_password: Zeroizing<String>,
}

pub fn provision_accounts() -> Result<ProvisionedAccounts, SandboxError> {
    ensure_group(SANDBOX_GROUP)?;
    let offline_password = random_password();
    let online_password = random_password();
    ensure_user(OFFLINE_USERNAME, &offline_password)?;
    ensure_user(ONLINE_USERNAME, &online_password)?;
    ensure_group_member(SANDBOX_GROUP, OFFLINE_USERNAME)?;
    ensure_group_member(SANDBOX_GROUP, ONLINE_USERNAME)?;
    Ok(ProvisionedAccounts {
        group_sid: resolve_account_sid_string(SANDBOX_GROUP)?,
        offline_sid: resolve_account_sid_string(OFFLINE_USERNAME)?,
        online_sid: resolve_account_sid_string(ONLINE_USERNAME)?,
        offline_password,
        online_password,
    })
}

pub fn remove_accounts(
    offline_sid: &str,
    online_sid: &str,
    group_sid: &str,
) -> Result<(), SandboxError> {
    verify_account(OFFLINE_USERNAME, offline_sid)?;
    verify_account(ONLINE_USERNAME, online_sid)?;
    verify_account(SANDBOX_GROUP, group_sid)?;
    verify_managed_user(OFFLINE_USERNAME)?;
    verify_managed_user(ONLINE_USERNAME)?;
    verify_managed_group(SANDBOX_GROUP)?;
    for username in [OFFLINE_USERNAME, ONLINE_USERNAME] {
        let status = unsafe { NetUserDel(std::ptr::null(), to_wide(username).as_ptr()) };
        if status != NERR_Success && status != NERR_USER_NOT_FOUND {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("NetUserDel failed for {username}: {status}"),
            ));
        }
    }
    let status = unsafe { NetLocalGroupDel(std::ptr::null(), to_wide(SANDBOX_GROUP).as_ptr()) };
    if status != NERR_Success && status != NERR_GROUP_NOT_FOUND {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("NetLocalGroupDel failed for {SANDBOX_GROUP}: {status}"),
        ));
    }
    Ok(())
}

pub fn remove_marked_accounts() -> Result<(), SandboxError> {
    for username in [OFFLINE_USERNAME, ONLINE_USERNAME] {
        if !user_exists(username)? {
            continue;
        }
        verify_managed_user_marker(username)?;
        let status = unsafe { NetUserDel(std::ptr::null(), to_wide(username).as_ptr()) };
        if status != NERR_Success && status != NERR_USER_NOT_FOUND {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("NetUserDel failed for {username}: {status}"),
            ));
        }
    }
    if group_exists(SANDBOX_GROUP)? {
        verify_managed_group(SANDBOX_GROUP)?;
        let status = unsafe { NetLocalGroupDel(std::ptr::null(), to_wide(SANDBOX_GROUP).as_ptr()) };
        if status != NERR_Success && status != NERR_GROUP_NOT_FOUND {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("NetLocalGroupDel failed for {SANDBOX_GROUP}: {status}"),
            ));
        }
    }
    Ok(())
}

pub fn verify_account(name: &str, expected_sid: &str) -> Result<(), SandboxError> {
    let actual = resolve_account_sid_string(name).map_err(|error| {
        SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("sandbox account {name} is unavailable: {}", error.message),
        )
    })?;
    if actual.eq_ignore_ascii_case(expected_sid) {
        Ok(())
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("sandbox account {name} SID no longer matches installed state"),
        ))
    }
}

pub fn verify_group_membership(username: &str, expected_group: &str) -> Result<(), SandboxError> {
    let username_wide = to_wide(username);
    let mut buffer = std::ptr::null_mut::<u8>();
    let mut entries_read = 0_u32;
    let mut total_entries = 0_u32;
    let status = unsafe {
        NetUserGetLocalGroups(
            std::ptr::null(),
            username_wide.as_ptr(),
            0,
            LG_INCLUDE_INDIRECT,
            &mut buffer,
            MAX_PREFERRED_LENGTH,
            &mut entries_read,
            &mut total_entries,
        )
    };
    if status != NERR_Success {
        if !buffer.is_null() {
            unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
        }
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("cannot inspect sandbox group membership for {username}: {status}"),
        ));
    }
    let memberships = if buffer.is_null() || entries_read == 0 {
        &[][..]
    } else {
        unsafe {
            std::slice::from_raw_parts(
                buffer.cast::<LOCALGROUP_USERS_INFO_0>(),
                entries_read as usize,
            )
        }
    };
    let groups = memberships
        .iter()
        .filter_map(|membership| wide_pointer_to_string(membership.lgrui0_name))
        .collect::<Vec<_>>();
    if !buffer.is_null() {
        unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
    }
    let expected_sid = resolve_account_sid_string(expected_group)?;
    let resolved_groups = groups
        .iter()
        .map(|group| resolve_account_sid_string(group).map(|sid| (group, sid)))
        .collect::<Result<Vec<_>, _>>()?;
    let member = resolved_groups
        .iter()
        .any(|(_, sid)| sid.eq_ignore_ascii_case(&expected_sid));
    let unexpected = resolved_groups.iter().find(|(_, sid)| {
        !sid.eq_ignore_ascii_case(&expected_sid) && !sid.eq_ignore_ascii_case(USERS_GROUP_SID)
    });
    if let Some((group, _)) = unexpected {
        Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("sandbox account {username} belongs to unexpected local group {group}"),
        ))
    } else if member {
        Ok(())
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("sandbox account {username} is no longer a member of {expected_group}"),
        ))
    }
}

pub fn verify_managed_identities() -> Result<(), SandboxError> {
    verify_managed_user(OFFLINE_USERNAME)?;
    verify_managed_user(ONLINE_USERNAME)?;
    verify_managed_group(SANDBOX_GROUP)
}

pub fn current_user_sid_string() -> Result<String, SandboxError> {
    let token = process_token(TOKEN_QUERY)?;
    token_user_sid_string(token.raw())
}

pub fn is_process_elevated() -> Result<bool, SandboxError> {
    let token = process_token(TOKEN_QUERY)?;
    let mut elevation: TOKEN_ELEVATION = unsafe { std::mem::zeroed() };
    let mut returned = 0_u32;
    let ok = unsafe {
        GetTokenInformation(
            token.raw(),
            TokenElevation,
            std::ptr::addr_of_mut!(elevation).cast::<c_void>(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
    };
    if ok == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::Internal,
            "GetTokenInformation(TokenElevation) failed",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(elevation.TokenIsElevated != 0)
}

pub fn validate_sid_string(value: &str) -> Result<(), SandboxError> {
    if value.starts_with("S-1-")
        && value.len() <= 184
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'S' || byte == b'-')
    {
        Ok(())
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            "owner SID has an invalid format",
        ))
    }
}

fn process_token(access: u32) -> Result<OwnedHandle, SandboxError> {
    let mut token = 0;
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), access, &mut token) };
    if ok == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::Internal,
            format!("OpenProcessToken failed for process {}", unsafe {
                GetCurrentProcessId()
            }),
            std::io::Error::last_os_error(),
        ));
    }
    OwnedHandle::new(token).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::Internal,
            "OpenProcessToken returned an invalid handle",
            error,
        )
    })
}

fn token_user_sid_string(token: isize) -> Result<String, SandboxError> {
    let mut required = 0_u32;
    unsafe {
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut required);
    }
    if required == 0 {
        return Err(SandboxError::new(
            SandboxErrorCode::Internal,
            "GetTokenInformation(TokenUser) returned no size",
        ));
    }
    let mut buffer = vec![0_u8; required as usize];
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast::<c_void>(),
            required,
            &mut required,
        )
    };
    if ok == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::Internal,
            "GetTokenInformation(TokenUser) failed",
            std::io::Error::last_os_error(),
        ));
    }
    let token_user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    sid_pointer_to_string(token_user.User.Sid)
}

fn ensure_group(name: &str) -> Result<(), SandboxError> {
    let mut name_wide = to_wide(name);
    let mut comment_wide = to_wide(MANAGED_GROUP_COMMENT);
    let mut info = LOCALGROUP_INFO_1 {
        lgrpi1_name: name_wide.as_mut_ptr(),
        lgrpi1_comment: comment_wide.as_mut_ptr(),
    };
    let mut parameter_error = 0_u32;
    let status = unsafe {
        NetLocalGroupAdd(
            std::ptr::null(),
            1,
            std::ptr::addr_of_mut!(info).cast::<u8>(),
            &mut parameter_error,
        )
    };
    if status != NERR_Success && status != ERROR_ALIAS_EXISTS && status != NERR_GROUP_EXISTS {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("NetLocalGroupAdd failed for {name}: {status} (parameter {parameter_error})"),
        ));
    }
    if status != NERR_Success {
        verify_managed_group(name).map_err(|_| {
            SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("local group {name} already exists and is not managed by Setsuna"),
            )
        })?;
        let deleted = unsafe { NetLocalGroupDel(std::ptr::null(), to_wide(name).as_ptr()) };
        if deleted != NERR_Success {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("cannot reset managed local group {name}: {deleted}"),
            ));
        }
        parameter_error = 0;
        let recreated = unsafe {
            NetLocalGroupAdd(
                std::ptr::null(),
                1,
                std::ptr::addr_of_mut!(info).cast::<u8>(),
                &mut parameter_error,
            )
        };
        if recreated != NERR_Success {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!(
                    "cannot recreate managed local group {name}: {recreated} (parameter {parameter_error})"
                ),
            ));
        }
    }
    Ok(())
}

fn ensure_user(name: &str, password: &str) -> Result<(), SandboxError> {
    let mut name_wide = to_wide(name);
    let mut password_wide = to_wide(password);
    let mut comment_wide = to_wide(MANAGED_USER_COMMENT);
    let mut info = USER_INFO_1 {
        usri1_name: name_wide.as_mut_ptr(),
        usri1_password: password_wide.as_mut_ptr(),
        usri1_password_age: 0,
        usri1_priv: USER_PRIV_USER,
        usri1_home_dir: std::ptr::null_mut(),
        usri1_comment: comment_wide.as_mut_ptr(),
        usri1_flags: MANAGED_USER_FLAGS,
        usri1_script_path: std::ptr::null_mut(),
    };
    let mut parameter_error = 0_u32;
    let added = unsafe {
        NetUserAdd(
            std::ptr::null(),
            1,
            std::ptr::addr_of_mut!(info).cast::<u8>(),
            &mut parameter_error,
        )
    };
    if added == NERR_Success {
        password_wide.zeroize();
        return Ok(());
    }
    if added != NERR_UserExists {
        password_wide.zeroize();
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot create sandbox user {name}: {added} (parameter {parameter_error})"),
        ));
    }
    // Recreate marked identities during install/repair. This clears lockout,
    // weakened flags, and every direct or indirect membership inherited from
    // the old managed group without claiming an unrelated same-name account.
    verify_managed_user_marker(name).map_err(|_| {
        SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("local user {name} already exists and is not managed by Setsuna"),
        )
    })?;
    let deleted = unsafe { NetUserDel(std::ptr::null(), name_wide.as_ptr()) };
    if deleted != NERR_Success {
        password_wide.zeroize();
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot reset managed sandbox user {name}: {deleted}"),
        ));
    }
    parameter_error = 0;
    let recreated = unsafe {
        NetUserAdd(
            std::ptr::null(),
            1,
            std::ptr::addr_of_mut!(info).cast::<u8>(),
            &mut parameter_error,
        )
    };
    password_wide.zeroize();
    if recreated != NERR_Success {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!(
                "cannot recreate sandbox user {name}: {recreated} (parameter {parameter_error})"
            ),
        ));
    }
    Ok(())
}

fn verify_managed_user(name: &str) -> Result<(), SandboxError> {
    verify_managed_user_configuration(name, true)
}

fn verify_managed_user_marker(name: &str) -> Result<(), SandboxError> {
    verify_managed_user_configuration(name, false)
}

fn verify_managed_user_configuration(
    name: &str,
    require_hardened_flags: bool,
) -> Result<(), SandboxError> {
    let name_wide = to_wide(name);
    let mut buffer = std::ptr::null_mut::<u8>();
    let status = unsafe { NetUserGetInfo(std::ptr::null(), name_wide.as_ptr(), 1, &mut buffer) };
    if status != NERR_Success || buffer.is_null() {
        if !buffer.is_null() {
            unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
        }
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("cannot inspect sandbox user {name}: {status}"),
        ));
    }
    let info = unsafe { &*buffer.cast::<USER_INFO_1>() };
    let comment = wide_pointer_to_string(info.usri1_comment);
    let privilege_valid = info.usri1_priv == USER_PRIV_USER;
    let flags_valid = privilege_valid
        && info.usri1_flags & MANAGED_USER_FLAGS == MANAGED_USER_FLAGS
        && info.usri1_flags & (UF_ACCOUNTDISABLE | UF_LOCKOUT | UF_PASSWORD_EXPIRED) == 0;
    unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
    if comment.as_deref() == Some(MANAGED_USER_COMMENT)
        && privilege_valid
        && (!require_hardened_flags || flags_valid)
    {
        Ok(())
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("sandbox user {name} does not carry the Setsuna management marker"),
        ))
    }
}

fn user_exists(name: &str) -> Result<bool, SandboxError> {
    let name_wide = to_wide(name);
    let mut buffer = std::ptr::null_mut::<u8>();
    let status = unsafe { NetUserGetInfo(std::ptr::null(), name_wide.as_ptr(), 1, &mut buffer) };
    if !buffer.is_null() {
        unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
    }
    if status == NERR_Success {
        Ok(true)
    } else if status == NERR_USER_NOT_FOUND {
        Ok(false)
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot inspect sandbox user {name}: {status}"),
        ))
    }
}

fn group_exists(name: &str) -> Result<bool, SandboxError> {
    let name_wide = to_wide(name);
    let mut buffer = std::ptr::null_mut::<u8>();
    let status =
        unsafe { NetLocalGroupGetInfo(std::ptr::null(), name_wide.as_ptr(), 1, &mut buffer) };
    if !buffer.is_null() {
        unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
    }
    if status == NERR_Success {
        Ok(true)
    } else if status == NERR_GROUP_NOT_FOUND {
        Ok(false)
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot inspect sandbox group {name}: {status}"),
        ))
    }
}

fn verify_managed_group(name: &str) -> Result<(), SandboxError> {
    let name_wide = to_wide(name);
    let mut buffer = std::ptr::null_mut::<u8>();
    let status =
        unsafe { NetLocalGroupGetInfo(std::ptr::null(), name_wide.as_ptr(), 1, &mut buffer) };
    if status != NERR_Success || buffer.is_null() {
        if !buffer.is_null() {
            unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
        }
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("cannot inspect sandbox group {name}: {status}"),
        ));
    }
    let comment =
        wide_pointer_to_string(unsafe { (*buffer.cast::<LOCALGROUP_INFO_1>()).lgrpi1_comment });
    unsafe { NetApiBufferFree(buffer.cast::<c_void>()) };
    if comment.as_deref() == Some(MANAGED_GROUP_COMMENT) {
        Ok(())
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("sandbox group {name} does not carry the Setsuna management marker"),
        ))
    }
}

fn ensure_group_member(group: &str, member: &str) -> Result<(), SandboxError> {
    let group_wide = to_wide(group);
    let mut member_wide = to_wide(member);
    let member_info = LOCALGROUP_MEMBERS_INFO_3 {
        lgrmi3_domainandname: member_wide.as_mut_ptr(),
    };
    // NetLocalGroupAddMembers returns 1378 when membership already exists. Any
    // other failure is caught by resolving and verifying the identities below.
    let status = unsafe {
        NetLocalGroupAddMembers(
            std::ptr::null(),
            group_wide.as_ptr(),
            3,
            std::ptr::addr_of!(member_info).cast::<u8>().cast_mut(),
            1,
        )
    };
    if status != NERR_Success && status != 1378 {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("NetLocalGroupAddMembers failed for {member}: {status}"),
        ));
    }
    Ok(())
}

fn resolve_account_sid_string(name: &str) -> Result<String, SandboxError> {
    let name_wide = to_wide(name);
    let mut sid_length = 0_u32;
    let mut domain_length = 0_u32;
    let mut use_type: SID_NAME_USE = 0;
    unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name_wide.as_ptr(),
            std::ptr::null_mut(),
            &mut sid_length,
            std::ptr::null_mut(),
            &mut domain_length,
            &mut use_type,
        );
    }
    if sid_length == 0 || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
        return Err(SandboxError::with_source(
            SandboxErrorCode::NeedsRepair,
            format!("LookupAccountNameW size query failed for {name}"),
            std::io::Error::last_os_error(),
        ));
    }
    let mut sid = vec![0_u8; sid_length as usize];
    let mut domain = vec![0_u16; domain_length as usize];
    let ok = unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name_wide.as_ptr(),
            sid.as_mut_ptr().cast::<c_void>(),
            &mut sid_length,
            domain.as_mut_ptr(),
            &mut domain_length,
            &mut use_type,
        )
    };
    if ok == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::NeedsRepair,
            format!("LookupAccountNameW failed for {name}"),
            std::io::Error::last_os_error(),
        ));
    }
    let length = unsafe { GetLengthSid(sid.as_mut_ptr().cast::<c_void>()) };
    if length == 0 {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("resolved SID is invalid for {name}"),
        ));
    }
    let mut copied = vec![0_u8; length as usize];
    if unsafe {
        CopySid(
            length,
            copied.as_mut_ptr().cast::<c_void>(),
            sid.as_mut_ptr().cast::<c_void>(),
        )
    } == 0
    {
        return Err(SandboxError::with_source(
            SandboxErrorCode::Internal,
            format!("CopySid failed for {name}"),
            std::io::Error::last_os_error(),
        ));
    }
    sid_pointer_to_string(copied.as_ptr().cast_mut().cast::<c_void>())
}

fn sid_pointer_to_string(sid: *mut c_void) -> Result<String, SandboxError> {
    let mut value = std::ptr::null_mut::<u16>();
    if unsafe { ConvertSidToStringSidW(sid, &mut value) } == 0 {
        return Err(SandboxError::with_source(
            SandboxErrorCode::Internal,
            "ConvertSidToStringSidW failed",
            std::io::Error::last_os_error(),
        ));
    }
    let length = unsafe {
        let mut length = 0;
        while *value.add(length) != 0 {
            length += 1;
        }
        length
    };
    let output = String::from_utf16(unsafe { std::slice::from_raw_parts(value, length) }).map_err(
        |error| {
            SandboxError::with_source(
                SandboxErrorCode::Internal,
                "Windows returned a non-Unicode SID",
                error,
            )
        },
    )?;
    unsafe {
        LocalFree(value as HLOCAL);
    }
    Ok(output)
}

fn wide_pointer_to_string(value: *const u16) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let length = unsafe {
        let mut length = 0;
        while *value.add(length) != 0 {
            length += 1;
        }
        length
    };
    String::from_utf16(unsafe { std::slice::from_raw_parts(value, length) }).ok()
}

fn random_password() -> Zeroizing<String> {
    let mut bytes = Zeroizing::new([0_u8; 48]);
    OsRng.fill_bytes(bytes.as_mut());
    Zeroizing::new(format!("S!{}a9", BASE64_URL.encode(bytes.as_ref())))
}
