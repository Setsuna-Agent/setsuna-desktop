use super::paths::canonical_existing;
use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode, SandboxRunRequest};
use fs2::FileExt;
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HLOCAL};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, ConvertStringSidToSidW,
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS, EXPLICIT_ACCESS_W,
    REVOKE_ACCESS, SDDL_REVISION_1, SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE, ACCESS_DENIED_ACE, ACL,
    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE,
    PROTECTED_DACL_SECURITY_INFORMATION, SE_DACL_PROTECTED,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ALL_ACCESS, FILE_APPEND_DATA, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES, FILE_TRAVERSE,
    FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA, FILE_WRITE_EA,
};

const SE_FILE_OBJECT: i32 = 1;
const WRITE_MASK: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_EXECUTE | FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD;
const DENY_WRITE_MASK: u32 = FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD;
const READ_MASK: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
const TRAVERSE_MASK: u32 = FILE_TRAVERSE | FILE_READ_ATTRIBUTES;
const MUTATING_MASK: u32 = FILE_WRITE_DATA
    | FILE_APPEND_DATA
    | FILE_WRITE_EA
    | FILE_WRITE_ATTRIBUTES
    | DELETE
    | FILE_DELETE_CHILD
    | WRITE_DAC_MASK
    | WRITE_OWNER_MASK;
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const WRITE_DAC_MASK: u32 = 0x0004_0000;
const WRITE_OWNER_MASK: u32 = 0x0008_0000;
const LOCAL_SYSTEM_SID: &str = "S-1-5-18";
const BUILTIN_ADMINISTRATORS_SID: &str = "S-1-5-32-544";

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

pub struct TemporaryAclGrant {
    sid: LocalSid,
    entries: Vec<TemporaryAclEntry>,
    indices: HashMap<String, usize>,
    lock_path: PathBuf,
    armed: bool,
}

struct TemporaryAclEntry {
    path: std::path::PathBuf,
    mask: u32,
    inheritance: u32,
}

impl TemporaryAclGrant {
    fn new(sid: &str, lock_path: &Path) -> Result<Self, SandboxError> {
        Ok(Self {
            sid: LocalSid::parse(sid)?,
            entries: Vec::new(),
            indices: HashMap::new(),
            lock_path: lock_path.to_path_buf(),
            armed: false,
        })
    }

    fn allow(&mut self, path: &Path, mask: u32, inheritance: u32) -> Result<(), SandboxError> {
        let key = path.to_string_lossy().to_lowercase();
        if let Some(index) = self.indices.get(&key).copied() {
            let entry = &self.entries[index];
            let combined_mask = entry.mask | mask;
            let combined_inheritance = entry.inheritance | inheritance;
            if combined_mask == entry.mask && combined_inheritance == entry.inheritance {
                return Ok(());
            }
            mutate_acl(
                path,
                self.sid.raw(),
                combined_mask,
                combined_inheritance,
                SET_ACCESS,
            )?;
            self.entries[index].mask = combined_mask;
            self.entries[index].inheritance = combined_inheritance;
        } else {
            mutate_acl(path, self.sid.raw(), mask, inheritance, SET_ACCESS)?;
            self.indices.insert(key, self.entries.len());
            self.entries.push(TemporaryAclEntry {
                path: path.to_path_buf(),
                mask,
                inheritance,
            });
        }
        Ok(())
    }

    fn revoke_unlocked(&mut self) {
        for entry in self.entries.iter().rev() {
            let _ = mutate_acl(&entry.path, self.sid.raw(), 0, 0, REVOKE_ACCESS);
        }
        self.entries.clear();
        self.indices.clear();
    }
}

impl Drop for TemporaryAclGrant {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if let Ok(_mutation) = AclMutationLock::acquire(&self.lock_path) {
            self.revoke_unlocked();
        }
    }
}

struct AclMutationLock {
    file: File,
}

impl AclMutationLock {
    fn acquire(path: &Path) -> Result<Self, SandboxError> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::UnsupportedPolicy,
                    "cannot open sandbox ACL mutation lock",
                    error,
                )
            })?;
        FileExt::lock_exclusive(&file).map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::UnsupportedPolicy,
                "cannot serialize sandbox ACL changes",
                error,
            )
        })?;
        Ok(Self { file })
    }
}

impl Drop for AclMutationLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

pub fn initialize_mutation_lock(path: &Path) -> Result<(), SandboxError> {
    let _lock = AclMutationLock::acquire(path)?;
    Ok(())
}

pub fn protect_state_path(
    path: &Path,
    owner_sid: &str,
    sandbox_group_sid: &str,
) -> Result<(), SandboxError> {
    let sddl = format!(
        "D:P(D;OICI;FA;;;{sandbox_group_sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;{owner_sid})"
    );
    apply_protected_dacl(path, &sddl, "sandbox state")
}

pub fn protect_runner_path(
    path: &Path,
    owner_sid: &str,
    sandbox_group_sid: &str,
) -> Result<(), SandboxError> {
    let sddl = format!(
        "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;{owner_sid})(A;OICI;FRFX;;;{sandbox_group_sid})"
    );
    apply_protected_dacl(path, &sddl, "sandbox runner")
}

fn apply_protected_dacl(path: &Path, sddl: &str, label: &str) -> Result<(), SandboxError> {
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
            format!("cannot build {label} DACL"),
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
            format!("cannot read {label} DACL"),
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
            format!("cannot protect {label} path {}: {result}", path.display()),
        ));
    }
    Ok(())
}

pub fn verify_runner_path(
    path: &Path,
    owner_sid: &str,
    sandbox_group_sid: &str,
) -> Result<(), SandboxError> {
    let owner = LocalSid::parse(owner_sid)?;
    let group = LocalSid::parse(sandbox_group_sid)?;
    let system = LocalSid::parse(LOCAL_SYSTEM_SID)?;
    let administrators = LocalSid::parse(BUILTIN_ADMINISTRATORS_SID)?;
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
                "cannot verify sandbox runner ACL for {}: {fetched}",
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
                format!("sandbox runner ACL is not protected: {}", path.display()),
            ));
        }

        let mut owner_full = false;
        let mut group_read_execute = false;
        let mut system_full = false;
        let mut administrators_full = false;
        let ace_count = unsafe { (*dacl).AceCount };
        for index in 0..u32::from(ace_count) {
            let mut ace_pointer = std::ptr::null_mut();
            if unsafe { GetAce(dacl, index, &mut ace_pointer) } == 0 || ace_pointer.is_null() {
                return Err(SandboxError::new(
                    SandboxErrorCode::NeedsRepair,
                    format!(
                        "sandbox runner ACL contains an unreadable ACE: {}",
                        path.display()
                    ),
                ));
            }
            let ace = unsafe { &*ace_pointer.cast::<ACCESS_ALLOWED_ACE>() };
            if ace.Header.AceType != ACCESS_ALLOWED_ACE_TYPE {
                return Err(SandboxError::new(
                    SandboxErrorCode::NeedsRepair,
                    format!(
                        "sandbox runner ACL contains an unexpected ACE: {}",
                        path.display()
                    ),
                ));
            }
            let sid = std::ptr::addr_of!(ace.SidStart).cast_mut().cast::<c_void>();
            if unsafe { EqualSid(sid, group.raw()) } != 0 {
                group_read_execute |=
                    ace.Mask & READ_MASK == READ_MASK && ace.Mask & MUTATING_MASK == 0;
            } else if unsafe { EqualSid(sid, owner.raw()) } != 0 {
                owner_full |= ace.Mask & FILE_ALL_ACCESS == FILE_ALL_ACCESS;
            } else if unsafe { EqualSid(sid, system.raw()) } != 0 {
                system_full |= ace.Mask & FILE_ALL_ACCESS == FILE_ALL_ACCESS;
            } else if unsafe { EqualSid(sid, administrators.raw()) } != 0 {
                administrators_full |= ace.Mask & FILE_ALL_ACCESS == FILE_ALL_ACCESS;
            } else {
                return Err(SandboxError::new(
                    SandboxErrorCode::NeedsRepair,
                    format!(
                        "sandbox runner ACL grants an unexpected identity: {}",
                        path.display()
                    ),
                ));
            }
        }
        if owner_full && group_read_execute && system_full && administrators_full {
            Ok(())
        } else {
            Err(SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!(
                    "sandbox runner ACL is incomplete or writable by its sandbox group: {}",
                    path.display()
                ),
            ))
        }
    })();
    unsafe { LocalFree(descriptor as HLOCAL) };
    result
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
    logon_sid: &str,
    capability_sid: &str,
    lock_path: &Path,
) -> Result<TemporaryAclGrant, SandboxError> {
    let _mutation = AclMutationLock::acquire(lock_path)?;
    let mut logon = TemporaryAclGrant::new(logon_sid, lock_path)?;
    let capability = LocalSid::parse(capability_sid)?;
    let prepared = (|| {
        let mut readable_roots = request.readable_roots.clone();
        readable_roots.push(request.workspace_root.clone());
        readable_roots.push(request.cwd.clone());
        for root in unique_existing_paths(&readable_roots)? {
            grant_temporary(&root, &mut logon, READ_MASK, inherited_for(&root))?;
            ensure_parent_traversal(&root, &mut logon)?;
        }

        for root in unique_existing_paths(&request.writable_roots)? {
            let inheritance = inherited_for(&root);
            // The per-logon SID satisfies the ordinary token check without granting
            // future or concurrent sandbox sessions access to this workspace.
            grant_temporary(&root, &mut logon, WRITE_MASK, inheritance)?;
            ensure_allow(&root, capability.raw(), WRITE_MASK, inheritance)?;
            ensure_parent_traversal(&root, &mut logon)?;
        }

        for root in unique_existing_paths(&request.protected_writable_roots)? {
            ensure_deny_write(&root, capability.raw(), inherited_for(&root))?;
        }
        Ok(())
    })();
    if let Err(error) = prepared {
        logon.revoke_unlocked();
        return Err(error);
    }
    logon.armed = true;
    Ok(logon)
}

pub fn prepare_request_bootstrap(
    request_path: &Path,
    account_sid: &str,
    lock_path: &Path,
) -> Result<TemporaryAclGrant, SandboxError> {
    let _mutation = AclMutationLock::acquire(lock_path)?;
    let mut account = TemporaryAclGrant::new(account_sid, lock_path)?;
    let prepared = (|| {
        let request_file = canonical_existing(request_path)?;
        grant_temporary(&request_file, &mut account, READ_MASK | DELETE, 0)?;
        let request_directory = request_file.parent().ok_or_else(|| {
            SandboxError::new(
                SandboxErrorCode::InvalidRequest,
                "sandbox request file has no parent directory",
            )
        })?;
        // The control directory is unique per execution. Granting the stable account
        // SID on shared ancestors would let one concurrent run revoke another's ACE.
        // Standard account tokens retain SeChangeNotifyPrivilege for ancestor traverse.
        grant_temporary(request_directory, &mut account, TRAVERSE_MASK, 0)
    })();
    if let Err(error) = prepared {
        account.revoke_unlocked();
        return Err(error);
    }
    account.armed = true;
    Ok(account)
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

fn ensure_parent_traversal(path: &Path, grant: &mut TemporaryAclGrant) -> Result<(), SandboxError> {
    let mut parent = path.parent();
    while let Some(candidate) = parent {
        if candidate.parent().is_none() {
            break;
        }
        grant_temporary(candidate, grant, TRAVERSE_MASK, 0)?;
        parent = candidate.parent();
    }
    Ok(())
}

fn grant_temporary(
    path: &Path,
    grant: &mut TemporaryAclGrant,
    mask: u32,
    inheritance: u32,
) -> Result<(), SandboxError> {
    grant.allow(path, mask, inheritance)
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
    // DENY_ACCESS appends an ACE. Revoke the policy SID's explicit entries first
    // so repeated executions cannot grow the protected root DACL indefinitely.
    mutate_acl(path, sid, 0, 0, REVOKE_ACCESS)?;
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
