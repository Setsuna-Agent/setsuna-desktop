use super::handle::OwnedHandle;
use super::paths::{canonical_existing, path_is_within};
use super::wide::to_wide;
use crate::protocol::{PermissionProfile, SandboxError, SandboxErrorCode, SandboxRunRequest};
use fs2::FileExt;
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{
    GetLastError, LocalFree, ERROR_ACCESS_DENIED, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HLOCAL,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, ConvertStringSidToSidW,
    GetNamedSecurityInfoW, GetSecurityInfo, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS,
    EXPLICIT_ACCESS_W, REVOKE_ACCESS, SDDL_REVISION_1, SET_ACCESS, TRUSTEE_IS_SID,
    TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
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
    CreateFileW, FileAttributeTagInfo, GetFileInformationByHandleEx, DELETE, FILE_ALL_ACCESS,
    FILE_APPEND_DATA, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_TAG_INFO, FILE_DELETE_CHILD, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_WRITE_ATTRIBUTES,
    FILE_WRITE_DATA, FILE_WRITE_EA, OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
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
// Node and esbuild walk upward to discover package/config boundaries. A non-inheriting
// directory read grant lets them enumerate each exact ancestor without granting access
// to any child file or sibling subtree.
const ANCESTOR_READ_MASK: u32 = READ_MASK;
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
const REPARSE_TAG_NAME_SURROGATE: u32 = 0x2000_0000;
const COMPLETION_MARKER_MASK: u32 = 0x0002_0000;
const READ_COMPLETION_DISCRIMINATOR: u32 = 0x7f31_a2c5;
const WRITE_COMPLETION_DISCRIMINATOR: u32 = 0xb4d8_091e;
const DENY_COMPLETION_DISCRIMINATOR: u32 = 0xe26c_5f73;
const LOCAL_SYSTEM_SID: &str = "S-1-5-18";
const BUILTIN_ADMINISTRATORS_SID: &str = "S-1-5-32-544";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenAccessInspection {
    Known(bool),
    SecurityDescriptorUnreadable,
}

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
    let read_completion = completion_marker_sid(capability_sid, READ_COMPLETION_DISCRIMINATOR)?;
    let write_completion = completion_marker_sid(capability_sid, WRITE_COMPLETION_DISCRIMINATOR)?;
    let deny_completion = completion_marker_sid(capability_sid, DENY_COMPLETION_DISCRIMINATOR)?;
    let writable_roots = unique_existing_paths(&request.writable_roots)?;
    let ephemeral_roots = unique_existing_paths(&request.ephemeral_writable_roots)?;

    if request.permission_profile == PermissionProfile::ReadOnly {
        let workspace_root = canonical_existing(&request.workspace_root)?;
        if !token_has_access(&workspace_root, read_access_token, READ_MASK)? {
            // A dedicated sandbox account cannot consume owner-only ACEs inherited
            // by an existing private workspace. Propagate one stable group read ACE
            // for that workspace; command-specific toolchain roots stay non-recursive.
            ensure_persistent_allow_aces(
                &workspace_root,
                &[(sandbox_group.raw(), READ_MASK)],
                &read_completion,
            )?;
        }
        // The upstream-compatible World restricting SID is required by core
        // Windows objects. An explicit capability deny still makes read-only
        // authoritative even when the host workspace is broadly writable.
        ensure_persistent_deny_ace(
            &workspace_root,
            capability.raw(),
            MUTATING_MASK,
            &deny_completion,
        )?;
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
        ensure_persistent_allow_aces(root, &allows, &write_completion)?;
    }
    for root in unique_existing_paths(&request.protected_writable_roots)? {
        ensure_persistent_deny_ace(&root, capability.raw(), MUTATING_MASK, &deny_completion)?;
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
            // Codex authorizes readable roots through its stable sandbox-users group.
            // Do the same here so runtime/toolchain access does not depend on one
            // logon SID or a tree-wide ACL rewrite for every command.
            ensure_ancestor_group_read_if_needed(
                &root,
                read_access_token,
                &self_contained_roots,
                sandbox_group.raw(),
            )?;
            ensure_group_read_if_needed(
                &root,
                read_access_token,
                sandbox_group.raw(),
                &read_completion,
            )?;
        }

        for root in &writable_roots {
            if !self_contained_roots
                .iter()
                .any(|contained| same_path(root, contained))
            {
                ensure_ancestor_group_read_if_needed(
                    root,
                    read_access_token,
                    &self_contained_roots,
                    sandbox_group.raw(),
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

fn ensure_group_read_if_needed(
    path: &Path,
    access_token: isize,
    sandbox_group_sid: *mut c_void,
    completion_marker: &LocalSid,
) -> Result<(), SandboxError> {
    // PATH entries and system toolchains are commonly readable through an inherited
    // group ACE while remaining protected from ACL changes by an unprivileged caller.
    if token_has_access(path, access_token, READ_MASK)? {
        return Ok(());
    }
    ensure_persistent_allow_aces(path, &[(sandbox_group_sid, READ_MASK)], completion_marker)
}

fn ensure_ancestor_group_read_if_needed(
    path: &Path,
    access_token: isize,
    stop_boundaries: &[PathBuf],
    sandbox_group_sid: *mut c_void,
) -> Result<(), SandboxError> {
    for candidate in ancestor_read_paths(path, stop_boundaries) {
        // SeChangeNotifyPrivilege bypasses directory traversal checks, but Node and
        // esbuild still open or enumerate ancestors during realpath and package lookup.
        // Grant the stable sandbox group read on this directory object only. This is
        // the narrow equivalent of Codex's persistent profile/read-root ACLs: later
        // commands can reuse it, while inheritance remains disabled.
        match inspect_token_access(&candidate, access_token, ANCESTOR_READ_MASK)? {
            TokenAccessInspection::Known(false) => {
                ensure_persistent_allow_aces_with_inheritance(
                    &candidate,
                    &[(sandbox_group_sid, ANCESTOR_READ_MASK)],
                    0,
                    None,
                )?;
            }
            TokenAccessInspection::Known(true)
            | TokenAccessInspection::SecurityDescriptorUnreadable => {
                // System-owned ancestors such as C:\Windows\Temp may deny READ_CONTROL
                // to the desktop user. Skipping a grant is fail-closed: the restricted
                // child still has to pass the existing filesystem ACL at access time.
            }
        }
    }
    Ok(())
}

fn ancestor_read_paths(path: &Path, stop_boundaries: &[PathBuf]) -> Vec<PathBuf> {
    let mut output = Vec::new();
    let mut parent = path.parent();
    while let Some(candidate) = parent {
        if candidate.parent().is_none()
            || stop_boundaries
                .iter()
                .any(|boundary| same_path(candidate, boundary))
        {
            break;
        }
        output.push(candidate.to_path_buf());
        parent = candidate.parent();
    }
    output
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_is_within(left, right) && path_is_within(right, left)
}

fn token_has_access(
    path: &Path,
    access_token: isize,
    requested: u32,
) -> Result<bool, SandboxError> {
    match inspect_token_access(path, access_token, requested)? {
        TokenAccessInspection::Known(allowed) => Ok(allowed),
        TokenAccessInspection::SecurityDescriptorUnreadable => {
            Err(access_inspection_error(path, ERROR_ACCESS_DENIED))
        }
    }
}

fn inspect_token_access(
    path: &Path,
    access_token: isize,
    requested: u32,
) -> Result<TokenAccessInspection, SandboxError> {
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
        if let Some(unreadable) = unreadable_access_inspection(fetched) {
            return Ok(unreadable);
        }
        return Err(access_inspection_error(path, fetched));
    }

    let result = access_check(descriptor, access_token, requested, path);
    unsafe { LocalFree(descriptor as HLOCAL) };
    result.map(TokenAccessInspection::Known)
}

fn unreadable_access_inspection(error: u32) -> Option<TokenAccessInspection> {
    (error == ERROR_ACCESS_DENIED).then_some(TokenAccessInspection::SecurityDescriptorUnreadable)
}

fn access_inspection_error(path: &Path, error: u32) -> SandboxError {
    SandboxError::new(
        SandboxErrorCode::UnsupportedPolicy,
        format!(
            "cannot inspect existing access for {}: {error}",
            path.display()
        ),
    )
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
    completion_marker: &LocalSid,
) -> Result<(), SandboxError> {
    ensure_persistent_allow_aces_with_inheritance(
        path,
        allows,
        inherited_for(path),
        Some(completion_marker),
    )
}

fn ensure_persistent_allow_aces_with_inheritance(
    path: &Path,
    allows: &[(*mut c_void, u32)],
    inheritance: u32,
    completion_marker: Option<&LocalSid>,
) -> Result<(), SandboxError> {
    if let Some(marker) = completion_marker {
        if persistent_acl_completion_is_valid(path, marker)? {
            return Ok(());
        }
    }

    let mut all_present = true;
    for (sid, mask) in allows {
        all_present &=
            path_has_effective_ace(path, *sid, ACCESS_ALLOWED_ACE_TYPE, *mask, inheritance)?;
    }
    if all_present && completion_marker.is_none() {
        return Ok(());
    }

    // A fresh capability also serves as the migration marker for the stable
    // sandbox-group grant. Carry every principal through materialization so an
    // interrupted legacy propagation cannot leave the group ACE root-only.
    let entries = allows
        .iter()
        .map(|(sid, mask)| EXPLICIT_ACCESS_W {
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
        })
        .collect::<Vec<_>>();
    apply_persistent_acl_entries_with_marker(path, &entries, completion_marker)
}

fn ensure_persistent_deny_ace(
    path: &Path,
    sid: *mut c_void,
    mask: u32,
    completion_marker: &LocalSid,
) -> Result<(), SandboxError> {
    let inheritance = inherited_for(path);
    if persistent_acl_completion_is_valid(path, completion_marker)? {
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
    apply_persistent_acl_entries_with_marker(path, &[entry], Some(completion_marker))
}

fn completion_marker_entry(marker: &LocalSid) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: COMPLETION_MARKER_MASK,
        grfAccessMode: SET_ACCESS,
        grfInheritance: 0,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: marker.raw().cast::<u16>(),
        },
    }
}

fn completion_marker_sid(
    capability_sid: &str,
    discriminator: u32,
) -> Result<LocalSid, SandboxError> {
    // Appending a sub-authority keeps marker SIDs structurally distinct from
    // every account/capability SID that the sandbox can place in a token.
    LocalSid::parse(&format!("{capability_sid}-{discriminator}"))
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

    let result = dacl_has_effective_ace(path, dacl, sid, ace_type, mask, inheritance);
    unsafe { LocalFree(descriptor as HLOCAL) };
    result
}

fn dacl_has_effective_ace(
    path: &Path,
    dacl: *mut ACL,
    sid: *mut c_void,
    ace_type: u8,
    mask: u32,
    inheritance: u32,
) -> Result<bool, SandboxError> {
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

#[cfg(test)]
fn apply_persistent_acl_entries(
    path: &Path,
    entries: &[EXPLICIT_ACCESS_W],
) -> Result<(), SandboxError> {
    apply_persistent_acl_entries_with_marker(path, entries, None)
}

fn apply_persistent_acl_entries_with_marker(
    path: &Path,
    entries: &[EXPLICIT_ACCESS_W],
    completion_marker: Option<&LocalSid>,
) -> Result<(), SandboxError> {
    let approved_root = std::fs::canonicalize(path).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot canonicalize persistent ACL root {}", path.display()),
            error,
        )
    })?;
    let root = PersistentAclObject::open(path, &approved_root)?;
    materialize_persistent_acl_object(&root, &approved_root, entries)?;
    if let Some(marker) = completion_marker {
        // Keep the root pinned until the marker is committed so a successful
        // marker can only describe the exact tree root that was reconciled.
        apply_missing_acl_entries_to_object(&root, &[completion_marker_entry(marker)])?;
    }
    Ok(())
}

struct PersistentAclObject {
    path: PathBuf,
    handle: OwnedHandle,
    is_directory: bool,
    is_name_surrogate: bool,
}

impl PersistentAclObject {
    fn open(path: &Path, approved_root: &Path) -> Result<Self, SandboxError> {
        let path_wide = to_wide(path.as_os_str());
        // Denying delete sharing pins this directory entry until the ACL update
        // finishes. SetFileSecurityW below therefore cannot be redirected to a
        // replacement inserted after the reparse/containment checks.
        let handle = OwnedHandle::new(unsafe {
            CreateFileW(
                path_wide.as_ptr(),
                READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                0,
            )
        })
        .map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::UnsupportedPolicy,
                format!("cannot pin persistent ACL object {}", path.display()),
                error,
            )
        })?;
        let mut tag_info = unsafe { std::mem::zeroed::<FILE_ATTRIBUTE_TAG_INFO>() };
        if unsafe {
            GetFileInformationByHandleEx(
                handle.raw(),
                FileAttributeTagInfo,
                std::ptr::addr_of_mut!(tag_info).cast::<c_void>(),
                std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        } == 0
        {
            return Err(SandboxError::with_source(
                SandboxErrorCode::UnsupportedPolicy,
                format!("cannot inspect persistent ACL object {}", path.display()),
                std::io::Error::last_os_error(),
            ));
        }
        let is_name_surrogate = tag_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            && is_name_surrogate_reparse_tag(tag_info.ReparseTag);
        if is_name_surrogate {
            let target = std::fs::canonicalize(path).map_err(|error| {
                SandboxError::with_source(
                    SandboxErrorCode::UnsupportedPolicy,
                    format!("cannot resolve sandbox link {}", path.display()),
                    error,
                )
            })?;
            if !path_is_within(&target, approved_root) {
                return Err(SandboxError::new(
                    SandboxErrorCode::UnsupportedPolicy,
                    format!(
                        "sandbox root {} contains a link that escapes to {}",
                        approved_root.display(),
                        target.display()
                    ),
                ));
            }
        }
        Ok(Self {
            path: path.to_path_buf(),
            handle,
            is_directory: tag_info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
            is_name_surrogate,
        })
    }
}

fn materialize_persistent_acl_object(
    object: &PersistentAclObject,
    approved_root: &Path,
    entries: &[EXPLICIT_ACCESS_W],
) -> Result<(), SandboxError> {
    let inherited_entries = entries
        .iter()
        .filter(|entry| entry.grfInheritance & (CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE) != 0)
        .collect::<Vec<_>>();
    if object.is_directory && !object.is_name_surrogate && !inherited_entries.is_empty() {
        for child_path in persistent_acl_child_paths(&object.path)? {
            let child = PersistentAclObject::open(&child_path, approved_root)?;
            let child_entries = inherited_entries
                .iter()
                .map(|entry| inherited_entry_for_child(entry, child.is_directory))
                .collect::<Vec<_>>();
            materialize_persistent_acl_object(&child, approved_root, &child_entries)?;
        }
    }
    // Name-surrogate objects were already validated against the approved root.
    // Do not pass their path to SetFileSecurityW because that API resolves the
    // link and would mutate the target instead of the inspected link object.
    if !object.is_name_surrogate {
        apply_missing_acl_entries_to_object(object, entries)?;
    }

    if object.is_directory && !object.is_name_surrogate && !inherited_entries.is_empty() {
        // Children created after the directory ACE was installed inherit it.
        // A second enumeration repairs only objects that fell into the earlier
        // traversal-to-parent-update window.
        for child_path in persistent_acl_child_paths(&object.path)? {
            let child = PersistentAclObject::open(&child_path, approved_root)?;
            let child_entries = inherited_entries
                .iter()
                .map(|entry| inherited_entry_for_child(entry, child.is_directory))
                .collect::<Vec<_>>();
            if !persistent_acl_entries_are_effective_for_object(&child, &child_entries)? {
                materialize_persistent_acl_object(&child, approved_root, &child_entries)?;
            }
        }
    }
    Ok(())
}

fn persistent_acl_completion_is_valid(
    path: &Path,
    completion_marker: &LocalSid,
) -> Result<bool, SandboxError> {
    let approved_root = std::fs::canonicalize(path).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!("cannot canonicalize persistent ACL root {}", path.display()),
            error,
        )
    })?;
    let root = PersistentAclObject::open(path, &approved_root)?;
    if !persistent_acl_entries_are_effective_for_object(
        &root,
        &[completion_marker_entry(completion_marker)],
    )? {
        return Ok(false);
    }

    // Completion markers avoid repeated DACL writes, but link safety is a
    // property of the current tree and must be checked on every execution.
    validate_persistent_acl_links(&root, &approved_root)?;
    Ok(true)
}

fn validate_persistent_acl_links(
    object: &PersistentAclObject,
    approved_root: &Path,
) -> Result<(), SandboxError> {
    if !object.is_directory || object.is_name_surrogate {
        return Ok(());
    }
    for child_path in persistent_acl_child_paths(&object.path)? {
        let child = PersistentAclObject::open(&child_path, approved_root)?;
        validate_persistent_acl_links(&child, approved_root)?;
    }
    Ok(())
}

fn persistent_acl_child_paths(directory: &Path) -> Result<Vec<PathBuf>, SandboxError> {
    let children = std::fs::read_dir(directory).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot enumerate persistent ACL root {}",
                directory.display()
            ),
            error,
        )
    })?;
    let mut output = Vec::new();
    for child in children {
        let child = child.map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::UnsupportedPolicy,
                format!(
                    "cannot enumerate persistent ACL root {}",
                    directory.display()
                ),
                error,
            )
        })?;
        output.push(child.path());
    }
    Ok(output)
}

fn is_name_surrogate_reparse_tag(tag: u32) -> bool {
    tag & REPARSE_TAG_NAME_SURROGATE != 0
}

fn inherited_entry_for_child(entry: &EXPLICIT_ACCESS_W, is_directory: bool) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: entry.grfAccessPermissions,
        grfAccessMode: entry.grfAccessMode,
        grfInheritance: if is_directory {
            entry.grfInheritance & (CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE)
        } else {
            0
        },
        Trustee: TRUSTEE_W {
            pMultipleTrustee: entry.Trustee.pMultipleTrustee,
            MultipleTrusteeOperation: entry.Trustee.MultipleTrusteeOperation,
            TrusteeForm: entry.Trustee.TrusteeForm,
            TrusteeType: entry.Trustee.TrusteeType,
            ptstrName: entry.Trustee.ptstrName,
        },
    }
}

fn persistent_acl_entries_are_effective_for_object(
    object: &PersistentAclObject,
    entries: &[EXPLICIT_ACCESS_W],
) -> Result<bool, SandboxError> {
    let (descriptor, dacl) = persistent_acl_object_dacl(object)?;
    let result = (|| {
        for entry in entries {
            if !persistent_acl_entry_is_effective(object, dacl, entry)? {
                return Ok(false);
            }
        }
        Ok(true)
    })();
    unsafe { LocalFree(descriptor as HLOCAL) };
    result
}

fn persistent_acl_entry_is_effective(
    object: &PersistentAclObject,
    dacl: *mut ACL,
    entry: &EXPLICIT_ACCESS_W,
) -> Result<bool, SandboxError> {
    if entry.Trustee.TrusteeForm != TRUSTEE_IS_SID || entry.Trustee.ptstrName.is_null() {
        return Ok(false);
    }
    let ace_type = match entry.grfAccessMode {
        SET_ACCESS => ACCESS_ALLOWED_ACE_TYPE,
        DENY_ACCESS => ACCESS_DENIED_ACE_TYPE,
        _ => return Ok(false),
    };
    dacl_has_effective_ace(
        &object.path,
        dacl,
        entry.Trustee.ptstrName.cast::<c_void>(),
        ace_type,
        entry.grfAccessPermissions,
        entry.grfInheritance,
    )
}

fn apply_missing_acl_entries_to_object(
    object: &PersistentAclObject,
    entries: &[EXPLICIT_ACCESS_W],
) -> Result<bool, SandboxError> {
    let (descriptor, old_dacl) = persistent_acl_object_dacl(object)?;
    let result = (|| {
        let mut missing = Vec::new();
        for entry in entries {
            if !persistent_acl_entry_is_effective(object, old_dacl, entry)? {
                missing.push(*entry);
            }
        }
        if missing.is_empty() {
            return Ok(false);
        }

        let mut new_dacl = std::ptr::null_mut();
        let merged = unsafe {
            SetEntriesInAclW(
                missing.len() as u32,
                missing.as_ptr(),
                old_dacl,
                &mut new_dacl,
            )
        };
        if merged != ERROR_SUCCESS {
            return Err(SandboxError::new(
                SandboxErrorCode::UnsupportedPolicy,
                format!(
                    "cannot construct persistent ACL for {}: {merged}",
                    object.path.display()
                ),
            ));
        }
        let path_wide = to_wide(object.path.as_os_str());
        let applied = set_file_dacl(&path_wide, new_dacl);
        unsafe { LocalFree(new_dacl as HLOCAL) };
        applied.map_err(|error| {
            SandboxError::with_source(
                SandboxErrorCode::UnsupportedPolicy,
                format!(
                    "cannot apply pinned persistent ACL for {}",
                    object.path.display()
                ),
                error,
            )
        })?;
        Ok(true)
    })();
    unsafe { LocalFree(descriptor as HLOCAL) };
    result
}

fn persistent_acl_object_dacl(
    object: &PersistentAclObject,
) -> Result<(*mut c_void, *mut ACL), SandboxError> {
    let mut descriptor = std::ptr::null_mut();
    let mut dacl = std::ptr::null_mut();
    let fetched = unsafe {
        GetSecurityInfo(
            object.handle.raw(),
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
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot inspect pinned persistent ACL for {}: {fetched}",
                object.path.display()
            ),
        ));
    }
    if unsafe { IsValidAcl(dacl) } == 0 {
        unsafe { LocalFree(descriptor as HLOCAL) };
        return Err(SandboxError::new(
            SandboxErrorCode::UnsupportedPolicy,
            format!("persistent ACL is invalid for {}", object.path.display()),
        ));
    }
    Ok((descriptor, dacl))
}

#[cfg(test)]
fn apply_non_recursive_acl_entries(
    path: &Path,
    entries: &[EXPLICIT_ACCESS_W],
) -> Result<(), SandboxError> {
    let approved_root = std::fs::canonicalize(path).map_err(|error| {
        SandboxError::with_source(
            SandboxErrorCode::UnsupportedPolicy,
            format!(
                "cannot canonicalize persistent ACL object {}",
                path.display()
            ),
            error,
        )
    })?;
    let object = PersistentAclObject::open(path, &approved_root)?;
    apply_missing_acl_entries_to_object(&object, entries)?;
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

#[cfg(test)]
mod tests {
    use super::{
        access_inspection_error, ancestor_read_paths, apply_non_recursive_acl_entries,
        apply_persistent_acl_entries, ensure_persistent_allow_aces, is_name_surrogate_reparse_tag,
        path_has_effective_ace, unreadable_access_inspection, LocalSid, TokenAccessInspection,
        ACCESS_ALLOWED_ACE_TYPE, COMPLETION_MARKER_MASK, READ_MASK,
    };
    use crate::protocol::SandboxErrorCode;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;
    use windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED;
    use windows_sys::Win32::Security::Authorization::{
        EXPLICIT_ACCESS_W, SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{CONTAINER_INHERIT_ACE, OBJECT_INHERIT_ACE};

    #[test]
    fn workspace_root_keeps_its_private_ancestors_in_the_read_plan() {
        let workspace = PathBuf::from(r"C:\Users\alice\Documents\project");

        assert_eq!(
            ancestor_read_paths(&workspace, std::slice::from_ref(&workspace)),
            vec![
                PathBuf::from(r"C:\Users\alice\Documents"),
                PathBuf::from(r"C:\Users\alice"),
                PathBuf::from(r"C:\Users"),
            ],
        );
    }

    #[test]
    fn nested_root_stops_at_an_already_authorized_workspace() {
        let workspace = PathBuf::from(r"C:\Users\alice\Documents\project");
        let nested = workspace.join("apps").join("renderer");

        assert_eq!(
            ancestor_read_paths(&nested, std::slice::from_ref(&workspace)),
            vec![workspace.join("apps")],
        );
    }

    #[test]
    fn unreadable_ancestor_security_descriptor_is_a_fail_closed_skip() {
        assert_eq!(
            unreadable_access_inspection(ERROR_ACCESS_DENIED),
            Some(TokenAccessInspection::SecurityDescriptorUnreadable),
        );
        assert_eq!(unreadable_access_inspection(2), None);

        let strict_error =
            access_inspection_error(&PathBuf::from(r"C:\Windows\Temp"), ERROR_ACCESS_DENIED);
        assert_eq!(strict_error.code, SandboxErrorCode::UnsupportedPolicy);
        assert!(strict_error.message.ends_with(": 5"));
    }

    #[test]
    fn missing_completion_marker_repairs_a_partial_legacy_grant() {
        let temporary = tempdir().expect("temporary ACL tree");
        let nested = temporary.path().join("node_modules").join("package");
        fs::create_dir_all(&nested).expect("nested directory");
        let existing_file = nested.join("index.js");
        fs::write(&existing_file, "module.exports = true;").expect("existing file");
        let group = LocalSid::parse("S-1-5-21-111111111-222222222-333333333-444444444")
            .expect("test group SID");
        let capability = LocalSid::parse("S-1-5-21-101010101-202020202-303030303-404040404")
            .expect("test capability SID");
        let completion = LocalSid::parse("S-1-5-21-505050505-606060606-707070707-808080808")
            .expect("test completion SID");
        let inheritance = CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE;
        let group_entry = allow_entry(&group, inheritance);
        let capability_entry = allow_entry(&capability, inheritance);

        // Reproduce termination after every access ACE reached the root but
        // before descendants were reconciled and the completion SID was added.
        apply_non_recursive_acl_entries(temporary.path(), &[group_entry, capability_entry])
            .expect("install root-only access ACEs");
        assert!(!has_read_allow(&nested, &group, inheritance));

        ensure_persistent_allow_aces(
            temporary.path(),
            &[(group.raw(), READ_MASK), (capability.raw(), READ_MASK)],
            &completion,
        )
        .expect("repair the tree and install the completion marker");

        assert!(has_read_allow(&nested, &group, inheritance));
        assert!(has_read_allow(&existing_file, &group, 0));
        assert!(has_read_allow(&nested, &capability, inheritance));
        assert!(has_read_allow(&existing_file, &capability, 0));
        assert!(path_has_effective_ace(
            temporary.path(),
            completion.raw(),
            ACCESS_ALLOWED_ACE_TYPE,
            COMPLETION_MARKER_MASK,
            0,
        )
        .expect("completion marker"));
    }

    #[test]
    fn root_gap_reconciliation_repairs_a_late_child_subtree() {
        let temporary = tempdir().expect("temporary ACL tree");
        let late_directory = temporary.path().join("created-during-root-gap");
        fs::create_dir(&late_directory).expect("late directory");
        let late_file = late_directory.join("late.txt");
        fs::write(&late_file, "late").expect("late file");
        let capability = LocalSid::parse("S-1-5-21-121212121-232323232-343434343-454545454")
            .expect("test capability SID");
        let inheritance = CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE;
        let entry = allow_entry(&capability, inheritance);

        // The child predates the non-recursive root update, so it models an item
        // created after the first enumeration and before root completion.
        apply_non_recursive_acl_entries(temporary.path(), &[entry]).expect("complete root grant");
        assert!(!has_read_allow(&late_directory, &capability, inheritance));

        apply_persistent_acl_entries(temporary.path(), &[entry]).expect("reconcile root gap");

        assert!(has_read_allow(&late_directory, &capability, inheritance));
        assert!(has_read_allow(&late_file, &capability, 0));
    }

    #[test]
    fn reparse_filter_skips_name_surrogates_but_keeps_cloud_placeholders() {
        const MOUNT_POINT: u32 = 0xA000_0003;
        const SYMBOLIC_LINK: u32 = 0xA000_000C;
        const CLOUD_PLACEHOLDER: u32 = 0x9000_001A;

        assert!(is_name_surrogate_reparse_tag(MOUNT_POINT));
        assert!(is_name_surrogate_reparse_tag(SYMBOLIC_LINK));
        assert!(!is_name_surrogate_reparse_tag(CLOUD_PLACEHOLDER));
    }

    fn allow_entry(sid: &LocalSid, inheritance: u32) -> EXPLICIT_ACCESS_W {
        EXPLICIT_ACCESS_W {
            grfAccessPermissions: READ_MASK,
            grfAccessMode: SET_ACCESS,
            grfInheritance: inheritance,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: std::ptr::null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: sid.raw().cast::<u16>(),
            },
        }
    }

    fn has_read_allow(path: &Path, sid: &LocalSid, inheritance: u32) -> bool {
        path_has_effective_ace(
            path,
            sid.raw(),
            ACCESS_ALLOWED_ACE_TYPE,
            READ_MASK,
            inheritance,
        )
        .expect("inspect test ACL")
    }
}
