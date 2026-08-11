use super::paths::{canonical_existing, path_is_within};
use super::wide::to_wide;
use crate::protocol::{PermissionProfile, SandboxError, SandboxErrorCode, SandboxRunRequest};
use fs2::FileExt;
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{
    GetLastError, LocalFree, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HLOCAL,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, ConvertStringSidToSidW,
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS, EXPLICIT_ACCESS_W,
    REVOKE_ACCESS, SDDL_REVISION_1, SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AccessCheck, AclSizeInformation, EqualSid, GetAce, GetAclInformation,
    GetSecurityDescriptorControl, InitializeSecurityDescriptor, IsValidAcl, IsValidSid,
    MapGenericMask, SetFileSecurityW, SetSecurityDescriptorDacl, ACCESS_ALLOWED_ACE,
    ACCESS_DENIED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, CONTAINER_INHERIT_ACE,
    DACL_SECURITY_INFORMATION, GENERIC_MAPPING, GROUP_SECURITY_INFORMATION, OBJECT_INHERIT_ACE,
    OWNER_SECURITY_INFORMATION, PRIVILEGE_SET, PROTECTED_DACL_SECURITY_INFORMATION,
    SECURITY_DESCRIPTOR, SE_DACL_PROTECTED,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ALL_ACCESS, FILE_APPEND_DATA, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES, FILE_WRITE_ATTRIBUTES,
    FILE_WRITE_DATA, FILE_WRITE_EA,
};

const SE_FILE_OBJECT: i32 = 1;
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;
const WRITE_MASK: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_EXECUTE | FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD;
// DELETE is inherited by each child. FILE_DELETE_CHILD is deliberately excluded
// so an allow on the workspace parent cannot bypass a protected child root.
const PERSISTENT_WRITE_MASK: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_EXECUTE | FILE_GENERIC_WRITE | DELETE;
const READ_MASK: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
const ANCESTOR_METADATA_MASK: u32 = FILE_READ_ATTRIBUTES;
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
const INHERIT_ONLY_ACE: u8 = 0x08;
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
        let key = format!("allow:{}", path.to_string_lossy().to_lowercase());
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
    read_access_token: isize,
    sandbox_group_sid: &str,
    capability_sid: &str,
    lock_path: &Path,
) -> Result<TemporaryAclGrant, SandboxError> {
    let _mutation = AclMutationLock::acquire(lock_path)?;
    let sandbox_group = LocalSid::parse(sandbox_group_sid)?;
    let capability = LocalSid::parse(capability_sid)?;
    let writable_roots = unique_existing_paths(&request.writable_roots)?;
    let ephemeral_roots = unique_existing_paths(&request.ephemeral_writable_roots)?;

    if request.permission_profile == PermissionProfile::ReadOnly {
        let workspace_root = canonical_existing(&request.workspace_root)?;
        if !token_has_access(&workspace_root, read_access_token, READ_MASK)? {
            // A dedicated sandbox account cannot consume owner-only ACEs inherited
            // by an existing private workspace. Propagate one stable group read ACE
            // for that workspace; command-specific toolchain roots stay non-recursive.
            ensure_persistent_allow_aces(&workspace_root, &[(sandbox_group.raw(), READ_MASK)])?;
        }
        // The upstream-compatible World restricting SID is required by core
        // Windows objects. An explicit capability deny still makes read-only
        // authoritative even when the host workspace is broadly writable.
        ensure_persistent_deny_ace(&workspace_root, capability.raw(), MUTATING_MASK)?;
    }

    // Stable roots are authorized once. Later commands observe the capability
    // ACE already present and perform no tree-wide filesystem metadata update.
    // Per-command temp roots are empty, so a non-recursive logon grant is enough.
    for root in &writable_roots {
        if ephemeral_roots
            .iter()
            .any(|ephemeral| same_path(root, ephemeral))
        {
            continue;
        }
        let mut allows = vec![(capability.raw(), PERSISTENT_WRITE_MASK)];
        if !token_has_access(root, read_access_token, PERSISTENT_WRITE_MASK)? {
            allows.push((sandbox_group.raw(), PERSISTENT_WRITE_MASK));
        }
        ensure_persistent_allow_aces(root, &allows)?;
    }
    for root in unique_existing_paths(&request.protected_writable_roots)? {
        ensure_persistent_deny_ace(&root, capability.raw(), MUTATING_MASK)?;
    }

    let mut logon = TemporaryAclGrant::new(logon_sid, lock_path)?;
    let prepared = (|| {
        let mut self_contained_roots = request.ephemeral_writable_roots.clone();
        self_contained_roots.push(request.workspace_root.clone());
        self_contained_roots.push(request.cwd.clone());
        let self_contained_roots = unique_existing_paths(&self_contained_roots)?;
        let mut readable_roots = request.readable_roots.clone();
        readable_roots.push(request.workspace_root.clone());
        readable_roots.push(request.cwd.clone());
        for root in unique_existing_paths(&readable_roots)? {
            if !self_contained_roots
                .iter()
                .any(|contained| same_path(&root, contained))
            {
                grant_ancestor_metadata_if_needed(
                    &root,
                    read_access_token,
                    &self_contained_roots,
                    &mut logon,
                )?;
            }
            grant_read_if_needed(&root, read_access_token, &mut logon)?;
        }

        for root in &writable_roots {
            if !self_contained_roots
                .iter()
                .any(|contained| same_path(root, contained))
            {
                grant_ancestor_metadata_if_needed(
                    root,
                    read_access_token,
                    &self_contained_roots,
                    &mut logon,
                )?;
            }
            if ephemeral_roots
                .iter()
                .any(|ephemeral| same_path(root, ephemeral))
            {
                grant_temporary(root, &mut logon, WRITE_MASK, inherited_for(root))?;
            }
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
        // The control directory is unique per execution. A non-inheriting read grant
        // lets the account canonicalize the request path without touching shared ancestors.
        grant_temporary(request_directory, &mut account, READ_MASK, 0)
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

fn grant_temporary(
    path: &Path,
    grant: &mut TemporaryAclGrant,
    mask: u32,
    inheritance: u32,
) -> Result<(), SandboxError> {
    grant.allow(path, mask, inheritance)
}

fn grant_read_if_needed(
    path: &Path,
    access_token: isize,
    grant: &mut TemporaryAclGrant,
) -> Result<(), SandboxError> {
    // PATH entries and system toolchains are commonly readable through an inherited
    // group ACE while remaining protected from ACL changes by an unprivileged caller.
    if token_has_access(path, access_token, READ_MASK)? {
        return Ok(());
    }
    grant_temporary(path, grant, READ_MASK, inherited_for(path))
}

fn grant_ancestor_metadata_if_needed(
    path: &Path,
    access_token: isize,
    stop_boundaries: &[PathBuf],
    grant: &mut TemporaryAclGrant,
) -> Result<(), SandboxError> {
    let mut parent = path.parent();
    while let Some(candidate) = parent {
        if candidate.parent().is_none() {
            break;
        }
        if stop_boundaries
            .iter()
            .any(|boundary| same_path(candidate, boundary))
        {
            break;
        }
        // SeChangeNotifyPrivilege bypasses directory traversal checks, but runtimes
        // such as Node still open every ancestor for lstat/realpath metadata. Grant
        // only non-inheriting metadata access, and only where the account needs it.
        if !token_has_access(candidate, access_token, ANCESTOR_METADATA_MASK)? {
            grant_temporary(candidate, grant, ANCESTOR_METADATA_MASK, 0)?;
        }
        parent = candidate.parent();
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_is_within(left, right) && path_is_within(right, left)
}

fn token_has_access(
    path: &Path,
    access_token: isize,
    requested: u32,
) -> Result<bool, SandboxError> {
    let mut path_wide = to_wide(path.as_os_str());
    let mut owner = std::ptr::null_mut();
    let mut group = std::ptr::null_mut();
    let mut dacl = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let fetched = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_mut_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            &mut group,
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if fetched != ERROR_SUCCESS || descriptor.is_null() {
        if !descriptor.is_null() {
            unsafe { LocalFree(descriptor as HLOCAL) };
        }
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot inspect existing access for {}: {fetched}",
                path.display()
            ),
        ));
    }

    let result = access_check(descriptor, access_token, requested, path);
    unsafe { LocalFree(descriptor as HLOCAL) };
    result
}

fn access_check(
    descriptor: *mut c_void,
    access_token: isize,
    requested: u32,
    path: &Path,
) -> Result<bool, SandboxError> {
    let mapping = GENERIC_MAPPING {
        GenericRead: FILE_GENERIC_READ,
        GenericWrite: FILE_GENERIC_WRITE,
        GenericExecute: FILE_GENERIC_EXECUTE,
        GenericAll: FILE_ALL_ACCESS,
    };
    let mut desired = requested;
    unsafe { MapGenericMask(&mut desired, &mapping) };

    let mut privilege_set_length = std::mem::size_of::<PRIVILEGE_SET>() as u32;
    let mut privilege_set = aligned_buffer(privilege_set_length as usize);
    loop {
        let mut granted = 0_u32;
        let mut allowed = 0_i32;
        let checked = unsafe {
            AccessCheck(
                descriptor,
                access_token,
                desired,
                &mapping,
                privilege_set.as_mut_ptr().cast::<PRIVILEGE_SET>(),
                &mut privilege_set_length,
                &mut granted,
                &mut allowed,
            )
        };
        if checked != 0 {
            return Ok(allowed != 0 && granted & desired == desired);
        }

        let error = unsafe { GetLastError() };
        if error == ERROR_INSUFFICIENT_BUFFER
            && privilege_set_length as usize > privilege_set.len() * std::mem::size_of::<usize>()
        {
            privilege_set = aligned_buffer(privilege_set_length as usize);
            continue;
        }
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot evaluate sandbox read access for {}: {error}",
                path.display()
            ),
        ));
    }
}

fn aligned_buffer(byte_length: usize) -> Vec<usize> {
    let word_length = byte_length.div_ceil(std::mem::size_of::<usize>());
    vec![0_usize; word_length]
}

fn ensure_persistent_allow_aces(
    path: &Path,
    allows: &[(*mut c_void, u32)],
) -> Result<(), SandboxError> {
    let inheritance = inherited_for(path);
    let missing = allows
        .iter()
        .filter_map(|(sid, mask)| {
            match path_has_effective_ace(path, *sid, ACCESS_ALLOWED_ACE_TYPE, *mask, inheritance) {
                Ok(true) => None,
                Ok(false) => Some(Ok(EXPLICIT_ACCESS_W {
                    grfAccessPermissions: *mask,
                    grfAccessMode: SET_ACCESS,
                    grfInheritance: inheritance,
                    Trustee: TRUSTEE_W {
                        pMultipleTrustee: std::ptr::null_mut(),
                        MultipleTrusteeOperation: 0,
                        TrusteeForm: TRUSTEE_IS_SID,
                        TrusteeType: TRUSTEE_IS_UNKNOWN,
                        ptstrName: sid.cast::<u16>(),
                    },
                })),
                Err(error) => Some(Err(error)),
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    if missing.is_empty() {
        return Ok(());
    }
    apply_persistent_acl_entries(path, &missing)
}

fn ensure_persistent_deny_ace(
    path: &Path,
    sid: *mut c_void,
    mask: u32,
) -> Result<(), SandboxError> {
    let inheritance = inherited_for(path);
    if path_has_effective_ace(path, sid, ACCESS_DENIED_ACE_TYPE, mask, inheritance)? {
        return Ok(());
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: DENY_ACCESS,
        grfInheritance: inheritance,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast::<u16>(),
        },
    };
    apply_persistent_acl_entries(path, &[entry])
}

fn path_has_effective_ace(
    path: &Path,
    sid: *mut c_void,
    ace_type: u8,
    mask: u32,
    inheritance: u32,
) -> Result<bool, SandboxError> {
    let mut path_wide = to_wide(path.as_os_str());
    let mut descriptor = std::ptr::null_mut();
    let mut dacl_out = std::mem::MaybeUninit::<*mut ACL>::uninit();
    let fetched = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_mut_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl_out.as_mut_ptr(),
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if fetched != ERROR_SUCCESS || descriptor.is_null() {
        if !descriptor.is_null() {
            unsafe { LocalFree(descriptor as HLOCAL) };
        }
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot inspect persistent ACL for {}: {fetched}",
                path.display()
            ),
        ));
    }
    // GetNamedSecurityInfoW initializes every requested output on success. Keep
    // the out-parameter uninitialized until then so no sentinel pointer can be
    // mistaken for an ACL returned by Windows.
    let dacl = unsafe { dacl_out.assume_init() };
    if dacl.is_null() || unsafe { IsValidAcl(dacl) } == 0 {
        unsafe { LocalFree(descriptor as HLOCAL) };
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!("persistent ACL is invalid for {}", path.display()),
        ));
    }

    let mut acl_info = ACL_SIZE_INFORMATION {
        AceCount: 0,
        AclBytesInUse: 0,
        AclBytesFree: 0,
    };
    if unsafe {
        GetAclInformation(
            dacl,
            std::ptr::addr_of_mut!(acl_info).cast::<c_void>(),
            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    } == 0
    {
        unsafe { LocalFree(descriptor as HLOCAL) };
        return Err(SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot inspect persistent ACL for {}", path.display()),
            std::io::Error::last_os_error(),
        ));
    }

    let mut found = false;
    let desired_mask = map_file_mask(mask);
    let required_inheritance = inheritance as u8;
    for index in 0..acl_info.AceCount {
        let mut ace_out = std::mem::MaybeUninit::<*mut c_void>::uninit();
        if unsafe { GetAce(dacl, index, ace_out.as_mut_ptr()) } == 0 {
            continue;
        }
        let ace_pointer = unsafe { ace_out.assume_init() };
        if ace_pointer.is_null() {
            continue;
        }
        let header = unsafe { ace_pointer.cast::<ACE_HEADER>().read_unaligned() };
        if header.AceType != ace_type || header.AceFlags & INHERIT_ONLY_ACE != 0 {
            continue;
        }
        if required_inheritance != 0
            && header.AceFlags & required_inheritance != required_inheritance
        {
            continue;
        }

        let sid_offset = std::mem::offset_of!(ACCESS_ALLOWED_ACE, SidStart);
        let ace_size = usize::from(header.AceSize);
        const MIN_SID_SIZE: usize = 8;
        if ace_size < sid_offset + MIN_SID_SIZE {
            continue;
        }
        let sub_authority_count =
            unsafe { ace_pointer.cast::<u8>().add(sid_offset + 1).read() } as usize;
        let sid_size = MIN_SID_SIZE + sub_authority_count * std::mem::size_of::<u32>();
        if sid_offset + sid_size > ace_size {
            continue;
        }
        let ace = unsafe { ace_pointer.cast::<ACCESS_ALLOWED_ACE>().read_unaligned() };
        let ace_sid = unsafe { ace_pointer.cast::<u8>().add(sid_offset).cast::<c_void>() };
        if unsafe { IsValidSid(ace_sid) } == 0 || unsafe { EqualSid(ace_sid, sid) } == 0 {
            continue;
        }
        let granted_mask = map_file_mask(ace.Mask);
        if granted_mask & desired_mask == desired_mask {
            found = true;
            break;
        }
    }
    unsafe { LocalFree(descriptor as HLOCAL) };
    Ok(found)
}

fn map_file_mask(mut mask: u32) -> u32 {
    let mapping = GENERIC_MAPPING {
        GenericRead: FILE_GENERIC_READ,
        GenericWrite: FILE_GENERIC_WRITE,
        GenericExecute: FILE_GENERIC_EXECUTE,
        GenericAll: FILE_ALL_ACCESS,
    };
    unsafe { MapGenericMask(&mut mask, &mapping) };
    mask
}

fn apply_persistent_acl_entries(
    path: &Path,
    entries: &[EXPLICIT_ACCESS_W],
) -> Result<(), SandboxError> {
    let mut path_wide = to_wide(path.as_os_str());
    let mut descriptor = std::ptr::null_mut();
    let mut old_dacl = std::ptr::null_mut();
    let fetched = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_mut_ptr(),
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
        if !descriptor.is_null() {
            unsafe { LocalFree(descriptor as HLOCAL) };
        }
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot read persistent ACL for {}: {fetched}",
                path.display()
            ),
        ));
    }
    let mut new_dacl = std::ptr::null_mut();
    let merged = unsafe {
        SetEntriesInAclW(
            entries.len() as u32,
            entries.as_ptr(),
            old_dacl,
            &mut new_dacl,
        )
    };
    if merged != ERROR_SUCCESS {
        unsafe { LocalFree(descriptor as HLOCAL) };
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot construct persistent ACL for {}: {merged}",
                path.display()
            ),
        ));
    }
    // This is intentionally the only propagating ACL operation. It runs only
    // when stable workspace authorization is missing.
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
            format!(
                "cannot apply persistent ACL for {}: {applied}",
                path.display()
            ),
        ));
    }
    Ok(())
}

fn mutate_acl(
    path: &Path,
    sid: *mut c_void,
    mask: u32,
    inheritance: u32,
    access_mode: i32,
) -> Result<(), SandboxError> {
    let path_wide = to_wide(path.as_os_str());
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
    // SetNamedSecurityInfoW automatically propagates every inheritable ACE in a
    // directory DACL to all existing descendants. That turns a one-path grant into
    // an unbounded tree rewrite. SetFileSecurityW updates only this object; OI/CI
    // still applies normally to children created after the grant.
    let applied = set_file_dacl(&path_wide, new_dacl);
    unsafe {
        LocalFree(new_dacl as HLOCAL);
        LocalFree(descriptor as HLOCAL);
    }
    if let Err(error) = applied {
        return Err(SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot apply non-recursive ACL for {}", path.display()),
            error,
        ));
    }
    Ok(())
}

fn set_file_dacl(path_wide: &[u16], dacl: *const ACL) -> Result<(), std::io::Error> {
    let mut descriptor: SECURITY_DESCRIPTOR = unsafe { std::mem::zeroed() };
    if unsafe {
        InitializeSecurityDescriptor(
            std::ptr::addr_of_mut!(descriptor).cast::<c_void>(),
            SECURITY_DESCRIPTOR_REVISION,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    if unsafe {
        SetSecurityDescriptorDacl(
            std::ptr::addr_of_mut!(descriptor).cast::<c_void>(),
            1,
            dacl,
            0,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    if unsafe {
        SetFileSecurityW(
            path_wide.as_ptr(),
            DACL_SECURITY_INFORMATION,
            std::ptr::addr_of_mut!(descriptor).cast::<c_void>(),
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}
