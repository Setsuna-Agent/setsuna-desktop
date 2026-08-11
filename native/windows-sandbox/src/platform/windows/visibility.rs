use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode};
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    HKEY, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_DWORD, REG_OPTION_NON_VOLATILE,
};

const USER_LIST_KEY: &str =
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList";

struct OwnedRegistryKey(HKEY);

impl Drop for OwnedRegistryKey {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }
}

pub fn hide_users(usernames: &[&str]) -> Result<(), SandboxError> {
    let key = create_key(KEY_SET_VALUE)?;
    for username in usernames {
        let hidden = 0_u32;
        let result = unsafe {
            RegSetValueExW(
                key.0,
                to_wide(username).as_ptr(),
                0,
                REG_DWORD,
                std::ptr::addr_of!(hidden).cast::<u8>(),
                std::mem::size_of::<u32>() as u32,
            )
        };
        if result != ERROR_SUCCESS {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("cannot hide sandbox account {username} from Winlogon: {result}"),
            ));
        }
    }
    Ok(())
}

pub fn verify_hidden(usernames: &[&str]) -> Result<(), SandboxError> {
    let key = open_key(KEY_QUERY_VALUE).map_err(|error| {
        SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!(
                "sandbox Winlogon visibility settings need repair: {}",
                error.message
            ),
        )
    })?;
    for username in usernames {
        let mut value = u32::MAX;
        let mut value_type = 0_u32;
        let mut bytes = std::mem::size_of::<u32>() as u32;
        let result = unsafe {
            RegQueryValueExW(
                key.0,
                to_wide(username).as_ptr(),
                std::ptr::null(),
                &mut value_type,
                std::ptr::addr_of_mut!(value).cast::<u8>(),
                &mut bytes,
            )
        };
        if result != ERROR_SUCCESS
            || value_type != REG_DWORD
            || bytes != std::mem::size_of::<u32>() as u32
            || value != 0
        {
            return Err(SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!("sandbox account {username} is not hidden from Winlogon"),
            ));
        }
    }
    Ok(())
}

pub fn unhide_users(usernames: &[&str]) -> Result<(), SandboxError> {
    let Some(key) = open_optional_key(KEY_SET_VALUE)? else {
        return Ok(());
    };
    for username in usernames {
        let result = unsafe { RegDeleteValueW(key.0, to_wide(username).as_ptr()) };
        if result != ERROR_SUCCESS && result != ERROR_FILE_NOT_FOUND {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("cannot remove Winlogon marker for {username}: {result}"),
            ));
        }
    }
    Ok(())
}

fn create_key(access: u32) -> Result<OwnedRegistryKey, SandboxError> {
    let mut key = 0;
    let result = unsafe {
        RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            to_wide(USER_LIST_KEY).as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            access,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        )
    };
    registry_key(result, key, "create sandbox Winlogon visibility key")
}

fn open_key(access: u32) -> Result<OwnedRegistryKey, SandboxError> {
    open_optional_key(access)?.ok_or_else(|| {
        SandboxError::new(
            SandboxErrorCode::SetupFailed,
            "sandbox Winlogon visibility key does not exist",
        )
    })
}

fn open_optional_key(access: u32) -> Result<Option<OwnedRegistryKey>, SandboxError> {
    let mut key = 0;
    let result = unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            to_wide(USER_LIST_KEY).as_ptr(),
            0,
            access,
            &mut key,
        )
    };
    if result == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    registry_key(result, key, "open sandbox Winlogon visibility key").map(Some)
}

fn registry_key(result: u32, key: HKEY, action: &str) -> Result<OwnedRegistryKey, SandboxError> {
    if result != ERROR_SUCCESS || key == 0 {
        Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot {action}: {result}"),
        ))
    } else {
        Ok(OwnedRegistryKey(key))
    }
}
