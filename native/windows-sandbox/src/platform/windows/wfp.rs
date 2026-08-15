use super::wide::to_wide;
use crate::protocol::{SandboxError, SandboxErrorCode};
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{
    LocalFree, FWP_E_FILTER_NOT_FOUND, FWP_E_NOT_FOUND, FWP_E_PROVIDER_NOT_FOUND,
    FWP_E_SUBLAYER_NOT_FOUND, HANDLE, HLOCAL,
};
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
    FwpmEngineClose0, FwpmEngineOpen0, FwpmFilterAdd0, FwpmFilterDeleteByKey0, FwpmFilterGetByKey0,
    FwpmFreeMemory0, FwpmProviderAdd0, FwpmProviderDeleteByKey0, FwpmProviderGetByKey0,
    FwpmSubLayerAdd0, FwpmSubLayerDeleteByKey0, FwpmSubLayerGetByKey0, FwpmTransactionAbort0,
    FwpmTransactionBegin0, FwpmTransactionCommit0, FWPM_ACTION0, FWPM_ACTION0_0,
    FWPM_CONDITION_ALE_USER_ID, FWPM_CONDITION_IP_PROTOCOL, FWPM_CONDITION_IP_REMOTE_ADDRESS,
    FWPM_CONDITION_IP_REMOTE_PORT, FWPM_DISPLAY_DATA0, FWPM_FILTER0, FWPM_FILTER0_0,
    FWPM_FILTER_CONDITION0, FWPM_FILTER_FLAG_PERSISTENT, FWPM_LAYER_ALE_AUTH_CONNECT_V4,
    FWPM_LAYER_ALE_AUTH_CONNECT_V6, FWPM_PROVIDER0, FWPM_PROVIDER_FLAG_PERSISTENT, FWPM_SESSION0,
    FWPM_SUBLAYER0, FWPM_SUBLAYER_FLAG_PERSISTENT, FWP_ACTION_BLOCK, FWP_ACTRL_MATCH_FILTER,
    FWP_BYTE_BLOB, FWP_CONDITION_VALUE0, FWP_CONDITION_VALUE0_0, FWP_EMPTY, FWP_MATCH_EQUAL,
    FWP_MATCH_GREATER, FWP_MATCH_LESS, FWP_MATCH_NOT_EQUAL, FWP_MATCH_TYPE,
    FWP_SECURITY_DESCRIPTOR_TYPE, FWP_UINT16, FWP_UINT32, FWP_UINT8, FWP_VALUE0, FWP_VALUE0_0,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::PSECURITY_DESCRIPTOR;
use windows_sys::Win32::System::Rpc::RPC_C_AUTHN_DEFAULT;
use windows_sys::Win32::System::Threading::INFINITE;

const SESSION_NAME: &str = "Setsuna Windows Sandbox WFP";
const PROVIDER_NAME: &str = "Setsuna Windows Sandbox WFP";
const PROVIDER_DESCRIPTION: &str =
    "Persistent WFP provider for Setsuna Windows sandbox network isolation";
const SUBLAYER_NAME: &str = "Setsuna Windows Sandbox WFP";
const SUBLAYER_DESCRIPTION: &str =
    "Persistent WFP sublayer for Setsuna Windows sandbox network isolation";
const PROVIDER_KEY: GUID = GUID::from_u128(0x5437d01b_8b38_4c87_b575_5534519728a1);
const SUBLAYER_KEY: GUID = GUID::from_u128(0x437fbe51_8169_423d_8f53_4e2b5a076d43);
// BFE may clamp near-maximum sublayer weights before persisting them (0xffff
// has been observed as 0xfffe, and 0xfffe as 0xfffd), which breaks post-install
// verification. Use a high but non-edge priority that BFE persists verbatim so
// install and verification agree on every machine.
const SUBLAYER_WEIGHT: u16 = 0xff00;
const LOOPBACK_V4: u32 = 0x7f00_0001;
const TCP_PROTOCOL: u8 = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AccountKind {
    Offline,
    Online,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConditionSpec {
    RemoteV4(FWP_MATCH_TYPE, u32),
    Protocol(FWP_MATCH_TYPE, u8),
    RemotePort(FWP_MATCH_TYPE, u16),
}

struct FilterSpec {
    key: GUID,
    name: &'static str,
    description: &'static str,
    layer_key: GUID,
    account: AccountKind,
    conditions: Vec<ConditionSpec>,
}

pub fn install(
    owner_sid: &str,
    offline_sid: &str,
    online_sid: &str,
    proxy_port_start: u16,
    proxy_port_end: u16,
) -> Result<(), SandboxError> {
    let specs = filter_specs(proxy_port_start, proxy_port_end)?;
    let engine = Engine::open()?;
    let mut transaction = engine.begin_transaction()?;
    remove_owned_objects(engine.handle, &specs)?;
    let object_security = ObjectSecurityDescriptor::new(owner_sid)?;
    add_provider(engine.handle, &object_security)?;
    add_sublayer(engine.handle, &object_security)?;

    let mut offline_user = UserMatchCondition::new(offline_sid)?;
    let mut online_user = UserMatchCondition::new(online_sid)?;
    for spec in &specs {
        let user = match spec.account {
            AccountKind::Offline => &mut offline_user,
            AccountKind::Online => &mut online_user,
        };
        add_filter(engine.handle, spec, user, &object_security)?;
    }
    transaction.commit()
}

pub fn verify(
    offline_sid: &str,
    online_sid: &str,
    proxy_port_start: u16,
    proxy_port_end: u16,
) -> Result<(), SandboxError> {
    verify_inner(offline_sid, online_sid, proxy_port_start, proxy_port_end).map_err(|error| {
        SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!(
                "Windows Filtering Platform sandbox policy needs repair: {}",
                error.message
            ),
        )
    })
}

fn verify_inner(
    offline_sid: &str,
    online_sid: &str,
    proxy_port_start: u16,
    proxy_port_end: u16,
) -> Result<(), SandboxError> {
    let specs = filter_specs(proxy_port_start, proxy_port_end)?;
    let engine = Engine::open()?;
    verify_provider(engine.handle)?;
    verify_sublayer(engine.handle)?;
    let mut offline_user = UserMatchCondition::new(offline_sid)?;
    let mut online_user = UserMatchCondition::new(online_sid)?;
    for spec in &specs {
        let user = match spec.account {
            AccountKind::Offline => &mut offline_user,
            AccountKind::Online => &mut online_user,
        };
        verify_filter(engine.handle, spec, user)?;
    }
    Ok(())
}

pub fn uninstall() -> Result<(), SandboxError> {
    let specs = filter_specs(1, 1)?;
    let engine = Engine::open()?;
    let mut transaction = engine.begin_transaction()?;
    remove_owned_objects(engine.handle, &specs)?;
    transaction.commit()
}

struct Engine {
    handle: HANDLE,
}

impl Engine {
    fn open() -> Result<Self, SandboxError> {
        let session_name = to_wide(SESSION_NAME);
        let mut session: FWPM_SESSION0 = unsafe { std::mem::zeroed() };
        session.displayData = FWPM_DISPLAY_DATA0 {
            name: session_name.as_ptr().cast_mut(),
            description: null_mut(),
        };
        session.txnWaitTimeoutInMSec = INFINITE;
        let mut handle = 0;
        let result = unsafe {
            FwpmEngineOpen0(
                null(),
                RPC_C_AUTHN_DEFAULT as u32,
                null(),
                &session,
                &mut handle,
            )
        };
        ensure_success(result, "FwpmEngineOpen0")?;
        Ok(Self { handle })
    }

    fn begin_transaction(&self) -> Result<Transaction<'_>, SandboxError> {
        ensure_success(
            unsafe { FwpmTransactionBegin0(self.handle, 0) },
            "FwpmTransactionBegin0",
        )?;
        Ok(Transaction {
            engine: self,
            committed: false,
        })
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        unsafe {
            FwpmEngineClose0(self.handle);
        }
    }
}

struct Transaction<'a> {
    engine: &'a Engine,
    committed: bool,
}

impl Transaction<'_> {
    fn commit(&mut self) -> Result<(), SandboxError> {
        ensure_success(
            unsafe { FwpmTransactionCommit0(self.engine.handle) },
            "FwpmTransactionCommit0",
        )?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.committed {
            unsafe {
                FwpmTransactionAbort0(self.engine.handle);
            }
        }
    }
}

struct UserMatchCondition {
    security_descriptor: PSECURITY_DESCRIPTOR,
    blob: FWP_BYTE_BLOB,
}

impl UserMatchCondition {
    fn new(account_sid: &str) -> Result<Self, SandboxError> {
        let sddl = to_wide(format!(
            "D:(A;;0x{FWP_ACTRL_MATCH_FILTER:08x};;;{account_sid})"
        ));
        let mut security_descriptor = null_mut();
        let mut security_descriptor_length = 0;
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut security_descriptor,
                &mut security_descriptor_length,
            )
        } == 0
        {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SetupFailed,
                "cannot build the WFP sandbox-account match descriptor",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self {
            security_descriptor,
            blob: FWP_BYTE_BLOB {
                size: security_descriptor_length,
                data: security_descriptor.cast::<u8>(),
            },
        })
    }

    fn as_filter_condition(&mut self) -> FWPM_FILTER_CONDITION0 {
        FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_ALE_USER_ID,
            matchType: FWP_MATCH_EQUAL,
            conditionValue: FWP_CONDITION_VALUE0 {
                r#type: FWP_SECURITY_DESCRIPTOR_TYPE,
                Anonymous: FWP_CONDITION_VALUE0_0 { sd: &mut self.blob },
            },
        }
    }
}

impl Drop for UserMatchCondition {
    fn drop(&mut self) {
        if !self.security_descriptor.is_null() {
            unsafe {
                LocalFree(self.security_descriptor as HLOCAL);
            }
        }
    }
}

struct ObjectSecurityDescriptor(PSECURITY_DESCRIPTOR);

impl ObjectSecurityDescriptor {
    fn new(owner_sid: &str) -> Result<Self, SandboxError> {
        let sddl = to_wide(format!("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GR;;;{owner_sid})"));
        let mut security_descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut security_descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(SandboxError::with_source(
                SandboxErrorCode::SetupFailed,
                "cannot build the Setsuna WFP object security descriptor",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Self(security_descriptor))
    }

    fn raw(&self) -> PSECURITY_DESCRIPTOR {
        self.0
    }
}

impl Drop for ObjectSecurityDescriptor {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0 as HLOCAL);
            }
        }
    }
}

fn add_provider(engine: HANDLE, security: &ObjectSecurityDescriptor) -> Result<(), SandboxError> {
    let name = to_wide(PROVIDER_NAME);
    let description = to_wide(PROVIDER_DESCRIPTION);
    let provider = FWPM_PROVIDER0 {
        providerKey: PROVIDER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_ptr().cast_mut(),
            description: description.as_ptr().cast_mut(),
        },
        flags: FWPM_PROVIDER_FLAG_PERSISTENT,
        providerData: empty_blob(),
        serviceName: null_mut(),
    };
    ensure_success(
        unsafe { FwpmProviderAdd0(engine, &provider, security.raw()) },
        "FwpmProviderAdd0",
    )
}

fn add_sublayer(engine: HANDLE, security: &ObjectSecurityDescriptor) -> Result<(), SandboxError> {
    let name = to_wide(SUBLAYER_NAME);
    let description = to_wide(SUBLAYER_DESCRIPTION);
    let mut provider_key = PROVIDER_KEY;
    let sublayer = FWPM_SUBLAYER0 {
        subLayerKey: SUBLAYER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_ptr().cast_mut(),
            description: description.as_ptr().cast_mut(),
        },
        flags: FWPM_SUBLAYER_FLAG_PERSISTENT,
        providerKey: &mut provider_key,
        providerData: empty_blob(),
        // Loopback can be hard-permitted by built-in policy. A high sublayer
        // priority ensures the account-scoped deny filters arbitrate first.
        weight: SUBLAYER_WEIGHT,
    };
    ensure_success(
        unsafe { FwpmSubLayerAdd0(engine, &sublayer, security.raw()) },
        "FwpmSubLayerAdd0",
    )
}

fn add_filter(
    engine: HANDLE,
    spec: &FilterSpec,
    user: &mut UserMatchCondition,
    security: &ObjectSecurityDescriptor,
) -> Result<(), SandboxError> {
    let name = to_wide(spec.name);
    let description = to_wide(spec.description);
    let mut provider_key = PROVIDER_KEY;
    let mut conditions = build_conditions(spec, user);
    let filter = FWPM_FILTER0 {
        filterKey: spec.key,
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_ptr().cast_mut(),
            description: description.as_ptr().cast_mut(),
        },
        flags: FWPM_FILTER_FLAG_PERSISTENT,
        providerKey: &mut provider_key,
        providerData: empty_blob(),
        layerKey: spec.layer_key,
        subLayerKey: SUBLAYER_KEY,
        weight: empty_value(),
        numFilterConditions: conditions.len() as u32,
        filterCondition: conditions.as_mut_ptr(),
        action: FWPM_ACTION0 {
            r#type: FWP_ACTION_BLOCK,
            Anonymous: FWPM_ACTION0_0 {
                filterType: zero_guid(),
            },
        },
        Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
        reserved: null_mut(),
        filterId: 0,
        effectiveWeight: empty_value(),
    };
    let mut filter_id = 0;
    ensure_success(
        unsafe { FwpmFilterAdd0(engine, &filter, security.raw(), &mut filter_id) },
        &format!("FwpmFilterAdd0({})", spec.name),
    )
}

fn build_conditions(
    spec: &FilterSpec,
    user: &mut UserMatchCondition,
) -> Vec<FWPM_FILTER_CONDITION0> {
    let mut conditions = Vec::with_capacity(spec.conditions.len() + 1);
    conditions.push(user.as_filter_condition());
    for condition in &spec.conditions {
        conditions.push(match *condition {
            ConditionSpec::RemoteV4(match_type, value) => FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                matchType: match_type,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT32,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint32: value },
                },
            },
            ConditionSpec::Protocol(match_type, value) => FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_PROTOCOL,
                matchType: match_type,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT8,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint8: value },
                },
            },
            ConditionSpec::RemotePort(match_type, value) => FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_REMOTE_PORT,
                matchType: match_type,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT16,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint16: value },
                },
            },
        });
    }
    conditions
}

fn verify_provider(engine: HANDLE) -> Result<(), SandboxError> {
    let provider = get_provider(engine)?;
    let provider = provider.as_ref();
    if !guid_equal(&provider.providerKey, &PROVIDER_KEY)
        || provider.flags & FWPM_PROVIDER_FLAG_PERSISTENT == 0
    {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            "Setsuna WFP provider metadata is invalid",
        ));
    }
    Ok(())
}

fn verify_sublayer(engine: HANDLE) -> Result<(), SandboxError> {
    let sublayer = get_sublayer(engine)?;
    let sublayer = sublayer.as_ref();
    let key_matches = guid_equal(&sublayer.subLayerKey, &SUBLAYER_KEY);
    let provider_matches = !sublayer.providerKey.is_null()
        && guid_equal(unsafe { &*sublayer.providerKey }, &PROVIDER_KEY);
    if !sublayer_metadata_matches(
        key_matches,
        sublayer.flags,
        provider_matches,
        sublayer.weight,
    ) {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!(
                concat!(
                    "Setsuna WFP sublayer metadata is invalid ",
                    "(keyMatches={}, flags=0x{:08x}, providerMatches={}, ",
                    "weight={}, expectedWeight={})",
                ),
                key_matches, sublayer.flags, provider_matches, sublayer.weight, SUBLAYER_WEIGHT,
            ),
        ));
    }
    Ok(())
}

fn sublayer_metadata_matches(
    key_matches: bool,
    flags: u32,
    provider_matches: bool,
    weight: u16,
) -> bool {
    key_matches
        && flags & FWPM_SUBLAYER_FLAG_PERSISTENT != 0
        && provider_matches
        && weight >= SUBLAYER_WEIGHT
}

fn verify_filter(
    engine: HANDLE,
    spec: &FilterSpec,
    user: &mut UserMatchCondition,
) -> Result<(), SandboxError> {
    let filter = get_filter(engine, &spec.key)?;
    let filter = filter.as_ref();
    let expected_conditions = build_conditions(spec, user);
    let actual_conditions = if filter.filterCondition.is_null() {
        &[][..]
    } else {
        unsafe {
            std::slice::from_raw_parts(filter.filterCondition, filter.numFilterConditions as usize)
        }
    };
    let conditions_match = actual_conditions.len() == expected_conditions.len()
        && expected_conditions.iter().all(|expected| {
            actual_conditions.iter().any(|actual| {
                guid_equal(&actual.fieldKey, &expected.fieldKey)
                    && actual.matchType == expected.matchType
                    && condition_value_equal(actual, expected)
            })
        });
    let provider_matches =
        !filter.providerKey.is_null() && guid_equal(unsafe { &*filter.providerKey }, &PROVIDER_KEY);
    if !guid_equal(&filter.filterKey, &spec.key)
        || filter.flags & FWPM_FILTER_FLAG_PERSISTENT == 0
        || !provider_matches
        || !guid_equal(&filter.layerKey, &spec.layer_key)
        || !guid_equal(&filter.subLayerKey, &SUBLAYER_KEY)
        || filter.action.r#type != FWP_ACTION_BLOCK
        || !conditions_match
    {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!("Setsuna WFP filter {} is missing or invalid", spec.name),
        ));
    }
    Ok(())
}

fn condition_value_equal(
    actual: &FWPM_FILTER_CONDITION0,
    expected: &FWPM_FILTER_CONDITION0,
) -> bool {
    if actual.conditionValue.r#type != expected.conditionValue.r#type {
        return false;
    }
    match expected.conditionValue.r#type {
        FWP_SECURITY_DESCRIPTOR_TYPE => unsafe {
            blobs_equal(
                actual.conditionValue.Anonymous.sd,
                expected.conditionValue.Anonymous.sd,
            )
        },
        FWP_UINT8 => unsafe {
            actual.conditionValue.Anonymous.uint8 == expected.conditionValue.Anonymous.uint8
        },
        FWP_UINT16 => unsafe {
            actual.conditionValue.Anonymous.uint16 == expected.conditionValue.Anonymous.uint16
        },
        FWP_UINT32 => unsafe {
            actual.conditionValue.Anonymous.uint32 == expected.conditionValue.Anonymous.uint32
        },
        _ => false,
    }
}

unsafe fn blobs_equal(actual: *mut FWP_BYTE_BLOB, expected: *mut FWP_BYTE_BLOB) -> bool {
    if actual.is_null() || expected.is_null() {
        return false;
    }
    let actual = unsafe { &*actual };
    let expected = unsafe { &*expected };
    if actual.size != expected.size || actual.data.is_null() || expected.data.is_null() {
        return false;
    }
    unsafe {
        std::slice::from_raw_parts(actual.data, actual.size as usize)
            == std::slice::from_raw_parts(expected.data, expected.size as usize)
    }
}

fn get_provider(engine: HANDLE) -> Result<FwpmOwned<FWPM_PROVIDER0>, SandboxError> {
    let mut value = null_mut();
    ensure_success(
        unsafe { FwpmProviderGetByKey0(engine, &PROVIDER_KEY, &mut value) },
        "FwpmProviderGetByKey0",
    )?;
    FwpmOwned::new(value, "FwpmProviderGetByKey0")
}

fn get_sublayer(engine: HANDLE) -> Result<FwpmOwned<FWPM_SUBLAYER0>, SandboxError> {
    let mut value = null_mut();
    ensure_success(
        unsafe { FwpmSubLayerGetByKey0(engine, &SUBLAYER_KEY, &mut value) },
        "FwpmSubLayerGetByKey0",
    )?;
    FwpmOwned::new(value, "FwpmSubLayerGetByKey0")
}

fn get_filter(engine: HANDLE, key: &GUID) -> Result<FwpmOwned<FWPM_FILTER0>, SandboxError> {
    let mut value = null_mut();
    ensure_success(
        unsafe { FwpmFilterGetByKey0(engine, key, &mut value) },
        "FwpmFilterGetByKey0",
    )?;
    FwpmOwned::new(value, "FwpmFilterGetByKey0")
}

struct FwpmOwned<T>(*mut T);

impl<T> FwpmOwned<T> {
    fn new(value: *mut T, operation: &str) -> Result<Self, SandboxError> {
        if value.is_null() {
            Err(SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!("{operation} returned a null object"),
            ))
        } else {
            Ok(Self(value))
        }
    }

    fn as_ref(&self) -> &T {
        unsafe { &*self.0 }
    }
}

impl<T> Drop for FwpmOwned<T> {
    fn drop(&mut self) {
        let mut value = self.0.cast::<c_void>();
        unsafe {
            FwpmFreeMemory0(&mut value);
        }
    }
}

fn remove_owned_objects(engine: HANDLE, specs: &[FilterSpec]) -> Result<(), SandboxError> {
    for spec in specs {
        ensure_success_or(
            unsafe { FwpmFilterDeleteByKey0(engine, &spec.key) },
            &format!("FwpmFilterDeleteByKey0({})", spec.name),
            &[FWP_E_FILTER_NOT_FOUND as u32, FWP_E_NOT_FOUND as u32],
        )?;
    }
    ensure_success_or(
        unsafe { FwpmSubLayerDeleteByKey0(engine, &SUBLAYER_KEY) },
        "FwpmSubLayerDeleteByKey0",
        &[FWP_E_NOT_FOUND as u32, FWP_E_SUBLAYER_NOT_FOUND as u32],
    )?;
    ensure_success_or(
        unsafe { FwpmProviderDeleteByKey0(engine, &PROVIDER_KEY) },
        "FwpmProviderDeleteByKey0",
        &[FWP_E_NOT_FOUND as u32, FWP_E_PROVIDER_NOT_FOUND as u32],
    )
}

fn filter_specs(start: u16, end: u16) -> Result<Vec<FilterSpec>, SandboxError> {
    if start == 0 || end < start {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            "sandbox WFP proxy port range is invalid",
        ));
    }
    Ok(vec![
        FilterSpec {
            key: GUID::from_u128(0x48579d96_dd45_427e_83ef_4c46de83ebdc),
            name: "setsuna_wfp_offline_block_v4",
            description: "Block all IPv4 connects from the Setsuna offline sandbox account",
            layer_key: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            account: AccountKind::Offline,
            conditions: vec![],
        },
        FilterSpec {
            key: GUID::from_u128(0x9264191d_59b0_4a65_88a9_bba7120c8294),
            name: "setsuna_wfp_offline_block_v6",
            description: "Block all IPv6 connects from the Setsuna offline sandbox account",
            layer_key: FWPM_LAYER_ALE_AUTH_CONNECT_V6,
            account: AccountKind::Offline,
            conditions: vec![],
        },
        FilterSpec {
            key: GUID::from_u128(0xe2db72d4_5709_4cb7_8977_e4056bfa59a3),
            name: "setsuna_wfp_online_block_v6",
            description: "Block IPv6 connects from the Setsuna online sandbox account",
            layer_key: FWPM_LAYER_ALE_AUTH_CONNECT_V6,
            account: AccountKind::Online,
            conditions: vec![],
        },
        FilterSpec {
            key: GUID::from_u128(0xe1b36f36_c74b_41c4_9c4e_8921d34edfc3),
            name: "setsuna_wfp_online_block_non_proxy_v4",
            description: "Block non-proxy IPv4 connects from the Setsuna online sandbox account",
            layer_key: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            account: AccountKind::Online,
            conditions: vec![ConditionSpec::RemoteV4(FWP_MATCH_NOT_EQUAL, LOOPBACK_V4)],
        },
        FilterSpec {
            key: GUID::from_u128(0x9ff561fd_41af_4bcf_a3a4_264edc45bb54),
            name: "setsuna_wfp_online_block_non_tcp_v4",
            description: "Block non-TCP IPv4 connects from the Setsuna online sandbox account",
            layer_key: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            account: AccountKind::Online,
            conditions: vec![ConditionSpec::Protocol(FWP_MATCH_NOT_EQUAL, TCP_PROTOCOL)],
        },
        FilterSpec {
            key: GUID::from_u128(0xc9c5ffaf_ce0c_439b_893a_533fc77419f2),
            name: "setsuna_wfp_online_block_low_ports_v4",
            description: "Block IPv4 TCP below the Setsuna proxy range",
            layer_key: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            account: AccountKind::Online,
            conditions: vec![
                ConditionSpec::Protocol(FWP_MATCH_EQUAL, TCP_PROTOCOL),
                ConditionSpec::RemotePort(FWP_MATCH_LESS, start),
            ],
        },
        FilterSpec {
            key: GUID::from_u128(0x38ed09e8_edcf_4664_ab00_3e28bae81725),
            name: "setsuna_wfp_online_block_high_ports_v4",
            description: "Block IPv4 TCP above the Setsuna proxy range",
            layer_key: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            account: AccountKind::Online,
            conditions: vec![
                ConditionSpec::Protocol(FWP_MATCH_EQUAL, TCP_PROTOCOL),
                ConditionSpec::RemotePort(FWP_MATCH_GREATER, end),
            ],
        },
    ])
}

fn ensure_success(result: u32, operation: &str) -> Result<(), SandboxError> {
    ensure_success_or(result, operation, &[])
}

fn ensure_success_or(result: u32, operation: &str, allowed: &[u32]) -> Result<(), SandboxError> {
    if result == 0 || allowed.contains(&result) {
        Ok(())
    } else {
        Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("{operation} failed with WFP error 0x{result:08x}"),
        ))
    }
}

fn guid_equal(left: &GUID, right: &GUID) -> bool {
    left.data1 == right.data1
        && left.data2 == right.data2
        && left.data3 == right.data3
        && left.data4 == right.data4
}

fn empty_blob() -> FWP_BYTE_BLOB {
    FWP_BYTE_BLOB {
        size: 0,
        data: null_mut(),
    }
}

fn empty_value() -> FWP_VALUE0 {
    FWP_VALUE0 {
        r#type: FWP_EMPTY,
        Anonymous: FWP_VALUE0_0 { uint64: null_mut() },
    }
}

fn zero_guid() -> GUID {
    GUID::from_u128(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn filter_keys_and_names_are_unique() {
        let specs = filter_specs(61_080, 61_089).expect("valid proxy range");
        let keys = specs
            .iter()
            .map(|spec| {
                (
                    spec.key.data1,
                    spec.key.data2,
                    spec.key.data3,
                    spec.key.data4,
                )
            })
            .collect::<BTreeSet<_>>();
        let names = specs.iter().map(|spec| spec.name).collect::<BTreeSet<_>>();
        assert_eq!(keys.len(), specs.len());
        assert_eq!(names.len(), specs.len());
    }

    #[test]
    fn online_policy_only_leaves_the_proxy_window_unblocked() {
        let specs = filter_specs(61_080, 61_089).expect("valid proxy range");
        let online = specs
            .iter()
            .filter(|spec| spec.account == AccountKind::Online)
            .collect::<Vec<_>>();
        assert_eq!(online.len(), 5);
        assert!(online.iter().any(|spec| {
            spec.conditions
                == vec![
                    ConditionSpec::Protocol(FWP_MATCH_EQUAL, TCP_PROTOCOL),
                    ConditionSpec::RemotePort(FWP_MATCH_LESS, 61_080),
                ]
        }));
        assert!(online.iter().any(|spec| {
            spec.conditions
                == vec![
                    ConditionSpec::Protocol(FWP_MATCH_EQUAL, TCP_PROTOCOL),
                    ConditionSpec::RemotePort(FWP_MATCH_GREATER, 61_089),
                ]
        }));
    }

    #[test]
    fn rejects_invalid_proxy_ranges() {
        assert!(filter_specs(0, 10).is_err());
        assert!(filter_specs(10, 9).is_err());
    }

    #[test]
    fn accepts_the_stable_high_priority_sublayer_weight() {
        assert_eq!(SUBLAYER_WEIGHT, 0xff00);
        assert!(sublayer_metadata_matches(
            true,
            FWPM_SUBLAYER_FLAG_PERSISTENT,
            true,
            SUBLAYER_WEIGHT,
        ));
        // Weights persisted by older builds (and BFE-clamped variants of them)
        // stay valid so existing installs do not flap into NeedsRepair.
        for legacy_weight in [0xfffd, 0xfffe, u16::MAX] {
            assert!(sublayer_metadata_matches(
                true,
                FWPM_SUBLAYER_FLAG_PERSISTENT,
                true,
                legacy_weight,
            ));
        }
        assert!(!sublayer_metadata_matches(
            true,
            FWPM_SUBLAYER_FLAG_PERSISTENT,
            true,
            SUBLAYER_WEIGHT - 1,
        ));
    }
}
