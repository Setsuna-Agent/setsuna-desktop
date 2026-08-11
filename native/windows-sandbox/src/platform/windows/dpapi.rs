use crate::protocol::{SandboxError, SandboxErrorCode};
use windows_sys::Win32::Foundation::{GetLastError, LocalFree, HLOCAL};
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN,
    CRYPT_INTEGER_BLOB,
};
use zeroize::Zeroizing;

fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr().cast_mut(),
    }
}

pub fn protect(bytes: &[u8]) -> Result<Vec<u8>, SandboxError> {
    let input = blob(bytes);
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("CryptProtectData failed: {}", unsafe { GetLastError() }),
        ));
    }
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as HLOCAL);
    }
    Ok(protected)
}

pub fn unprotect_string(bytes: &[u8]) -> Result<Zeroizing<String>, SandboxError> {
    let input = blob(bytes);
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("CryptUnprotectData failed: {}", unsafe { GetLastError() }),
        ));
    }
    let plaintext = Zeroizing::new(unsafe {
        std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
    });
    unsafe {
        LocalFree(output.pbData as HLOCAL);
    }
    let text = String::from_utf8(plaintext.to_vec()).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::NeedsRepair,
            "sandbox credential is not UTF-8",
            error,
        )
    })?;
    Ok(Zeroizing::new(text))
}
