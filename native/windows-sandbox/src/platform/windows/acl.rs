use super::paths::canonical_existing;
use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode, SandboxRunRequest};
use std::collections::HashSet;
use std::ffi::c_void;
use std::path::Path;
use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HLOCAL};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, ConvertStringSidToSidW,
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS, EXPLICIT_ACCESS_W,
    SDDL_REVISION_1, SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, GetSecurityDescriptorControl, ACCESS_DENIED_ACE, ACL, CONTAINER_INHERIT_ACE,
    DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE, PROTECTED_DACL_SECURITY_INFORMATION,
    SE_DACL_PROTECTED,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ALL_ACCESS, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES, FILE_TRAVERSE,
};

const SE_FILE_OBJECT: i32 = 1;
const WRITE_MASK: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_EXECUTE | FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD;
const DENY_WRITE_MASK: u32 = FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD;
const READ_MASK: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
const TRAVERSE_MASK: u32 = FILE_TRAVERSE | FILE_READ_ATTRIBUTES;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;

struct LocalSid(*mut c_void);

impl LocalSid {
    fn parse(value: &str) -> Result<Self, SandboxError> {
        let wide = to_wide(value);
        let mut sid = std::ptr::null_mut();
        if unsafe { ConvertStringSidToSidW(wide.as_ptr(), &mut sid) } == 0 {
            return Err(SandboxError::with_source(
                SandboxErrorCode::Internal,
                format!("invalid SID in sandbox state: {value}"),
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self(sid))
    }

    fn raw(&self) -> *mut c_void {
        self.0
    }
}

impl Drop for LocalSid {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0 as HLOCAL);
            }
        }
    }
}

pub fn protect_state_path(
    path: &Path,
    owner_sid: &str,
    sandbox_group_sid: &str,
) -> Result<(), SandboxError> {
    let sddl = format!(
        "D:P(D;OICI;FA;;;{sandbox_group_sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;{owner_sid})"
    );
    let sddl_wide = to_wide(sddl);
    let mut descriptor = std::ptr::null_mut();
    let mut descriptor_length = 0_u32;
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl_wide.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            &mut descriptor_length,
        )
    } == 0
    {
        return Err(SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            "cannot build sandbox state DACL",
            std::io::Error::last_os_error(),
        ));
    }
    let mut present = 0_i32;
    let mut defaulted = 0_i32;
    let mut dacl_pointer: *mut ACL = std::ptr::null_mut();
    let got_dacl = unsafe {
        windows_sys::Win32::Security::GetSecurityDescriptorDacl(
            descriptor,
            &mut present,
            &mut dacl_pointer,
            &mut defaulted,
        )
    };
    if got_dacl == 0 || present == 0 {
        unsafe {
            LocalFree(descriptor as HLOCAL);
        }
        return Err(SandboxError::with_source(
            SandboxErrorCode::SetupFailed,
            "cannot read sandbox state DACL",
            std::io::Error::last_os_error(),
        ));
    }
    let mut path_wide = to_wide(path.as_os_str());
    let result = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_mut_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl_pointer,
            std::ptr::null_mut(),
        )
    };
    unsafe {
        LocalFree(descriptor as HLOCAL);
    }
    if result != ERROR_SUCCESS {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!(
                "cannot protect sandbox state path {}: {result}",
                path.display()
            ),
        ));
    }
    Ok(())
}

pub fn verify_state_path(path: &Path, sandbox_group_sid: &str) -> Result<(), SandboxError> {
    let group = LocalSid::parse(sandbox_group_sid)?;
    let mut path_wide = to_wide(path.as_os_str());
    let mut descriptor = std::ptr::null_mut();
    let mut dacl = std::ptr::null_mut();
    let fetched = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_mut_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if fetched != ERROR_SUCCESS || descriptor.is_null() || dacl.is_null() {
        if !descriptor.is_null() {
            unsafe { LocalFree(descriptor as HLOCAL) };
        }
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!(
                "cannot verify sandbox state ACL for {}: {fetched}",
                path.display()
            ),
        ));
    }
    let result = (|| {
        let mut control = 0_u16;
        let mut revision = 0_u32;
        if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0
            || control & SE_DACL_PROTECTED == 0
        {
            return Err(SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!("sandbox state ACL is not protected: {}", path.display()),
            ));
        }

        let ace_count = unsafe { (*dacl).AceCount };
        for index in 0..u32::from(ace_count) {
            let mut ace_pointer = std::ptr::null_mut();
            if unsafe { GetAce(dacl, index, &mut ace_pointer) } == 0 || ace_pointer.is_null() {
                continue;
            }
            let ace = unsafe { &*ace_pointer.cast::<ACCESS_DENIED_ACE>() };
            if ace.Header.AceType != ACCESS_DENIED_ACE_TYPE
                || ace.Mask & FILE_ALL_ACCESS != FILE_ALL_ACCESS
            {
                continue;
            }
            let sid = std::ptr::addr_of!(ace.SidStart).cast_mut().cast::<c_void>();
            if unsafe { EqualSid(sid, group.raw()) } != 0 {
                return Ok(());
            }
        }
        Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!(
                "sandbox state ACL no longer denies the managed sandbox group: {}",
                path.display()
            ),
        ))
    })();
    unsafe { LocalFree(descriptor as HLOCAL) };
    result
}

pub fn prepare_execution(
    request: &SandboxRunRequest,
    request_path: &Path,
    logon_sid: &str,
    capability_sid: &str,
) -> Result<(), SandboxError> {
    let logon = LocalSid::parse(logon_sid)?;
    let capability = LocalSid::parse(capability_sid)?;
    let mut traversed = HashSet::new();

    let mut readable_roots = request.readable_roots.clone();
    readable_roots.push(request.workspace_root.clone());
    readable_roots.push(request.cwd.clone());
    for root in unique_existing_paths(&readable_roots)? {
        ensure_allow(&root, logon.raw(), READ_MASK, inherited_for(&root))?;
        ensure_parent_traversal(&root, logon.raw(), &mut traversed)?;
    }

    for root in unique_existing_paths(&request.writable_roots)? {
        let inheritance = inherited_for(&root);
        // The per-logon SID satisfies the ordinary token check without granting
        // future or concurrent sandbox sessions access to this workspace.
        ensure_allow(&root, logon.raw(), WRITE_MASK, inheritance)?;
        ensure_allow(&root, capability.raw(), WRITE_MASK, inheritance)?;
        ensure_parent_traversal(&root, logon.raw(), &mut traversed)?;
    }

    for root in unique_existing_paths(&request.protected_writable_roots)? {
        ensure_deny_write(&root, capability.raw(), inherited_for(&root))?;
    }

    let request_file = canonical_existing(request_path)?;
    ensure_allow(&request_file, logon.raw(), READ_MASK, 0)?;
    ensure_parent_traversal(&request_file, logon.raw(), &mut traversed)?;
    Ok(())
}

fn unique_existing_paths(
    paths: &[std::path::PathBuf],
) -> Result<Vec<std::path::PathBuf>, SandboxError> {
    let mut keys = HashSet::new();
    let mut output = Vec::new();
    for path in paths {
        let canonical = canonical_existing(path)?;
        let key = canonical.to_string_lossy().to_lowercase();
        if keys.insert(key) {
            output.push(canonical);
        }
    }
    Ok(output)
}

fn inherited_for(path: &Path) -> u32 {
    if path.is_dir() {
        CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE
    } else {
        0
    }
}

fn ensure_parent_traversal(
    path: &Path,
    sid: *mut c_void,
    visited: &mut HashSet<String>,
) -> Result<(), SandboxError> {
    let mut parent = path.parent();
    while let Some(candidate) = parent {
        if candidate.parent().is_none() {
            break;
        }
        let key = candidate.to_string_lossy().to_lowercase();
        if visited.insert(key) {
            ensure_allow(candidate, sid, TRAVERSE_MASK, 0)?;
        }
        parent = candidate.parent();
    }
    Ok(())
}

fn ensure_allow(
    path: &Path,
    sid: *mut c_void,
    mask: u32,
    inheritance: u32,
) -> Result<(), SandboxError> {
    mutate_acl(path, sid, mask, inheritance, SET_ACCESS)
}

fn ensure_deny_write(path: &Path, sid: *mut c_void, inheritance: u32) -> Result<(), SandboxError> {
    mutate_acl(path, sid, DENY_WRITE_MASK, inheritance, DENY_ACCESS)
}

fn mutate_acl(
    path: &Path,
    sid: *mut c_void,
    mask: u32,
    inheritance: u32,
    access_mode: i32,
) -> Result<(), SandboxError> {
    let mut path_wide = to_wide(path.as_os_str());
    let mut descriptor = std::ptr::null_mut();
    let mut old_dacl = std::ptr::null_mut();
    let fetched = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if fetched != ERROR_SUCCESS {
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot read ACL for {}: {fetched}", path.display()),
        ));
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: access_mode,
        grfInheritance: inheritance,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast::<u16>(),
        },
    };
    let mut new_dacl = std::ptr::null_mut();
    let merged = unsafe { SetEntriesInAclW(1, &entry, old_dacl, &mut new_dacl) };
    if merged != ERROR_SUCCESS {
        unsafe {
            LocalFree(descriptor as HLOCAL);
        }
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot construct ACL for {}: {merged}", path.display()),
        ));
    }
    let applied = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_mut_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            new_dacl,
            std::ptr::null_mut(),
        )
    };
    unsafe {
        LocalFree(new_dacl as HLOCAL);
        LocalFree(descriptor as HLOCAL);
    }
    if applied != ERROR_SUCCESS {
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot apply ACL for {}: {applied}", path.display()),
        ));
    }
    Ok(())
}
