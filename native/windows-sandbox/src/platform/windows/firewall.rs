use crate::protocol::{SandboxError, SandboxErrorCode};
use windows::core::{Interface, BSTR};
use windows::Win32::Foundation::{S_OK, VARIANT_TRUE};
use windows::Win32::NetworkManagement::WindowsFirewall::{
    INetFwPolicy2, INetFwRule3, INetFwRules, NetFwPolicy2, NetFwRule, NET_FW_ACTION,
    NET_FW_ACTION_ALLOW, NET_FW_ACTION_BLOCK, NET_FW_IP_PROTOCOL_ANY, NET_FW_IP_PROTOCOL_TCP,
    NET_FW_IP_PROTOCOL_UDP, NET_FW_MODIFY_STATE, NET_FW_MODIFY_STATE_OK, NET_FW_PROFILE2_ALL,
    NET_FW_PROFILE2_DOMAIN, NET_FW_PROFILE2_PRIVATE, NET_FW_PROFILE2_PUBLIC, NET_FW_RULE_DIR_OUT,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};

const LOOPBACK_ADDRESSES: &str = "127.0.0.0/8,::/127";
const PROXY_LOOPBACK_ADDRESS: &str = "127.0.0.1";
const NON_PROXY_LOOPBACK_ADDRESSES: &str = "127.0.0.0,127.0.0.2-127.255.255.255,::/127";
const NON_LOOPBACK_ADDRESSES: &str = "0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255,::,::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff";
const RULE_OFFLINE_NON_LOOPBACK: &str = "setsuna_sandbox_offline_block_non_loopback";
const RULE_OFFLINE_LOOPBACK: &str = "setsuna_sandbox_offline_block_loopback";
const RULE_ONLINE_NON_LOOPBACK: &str = "setsuna_sandbox_online_block_non_loopback";
const RULE_ONLINE_PROXY_ALLOW: &str = "setsuna_sandbox_online_allow_proxy";
const RULE_ONLINE_LOOPBACK_UDP: &str = "setsuna_sandbox_online_block_loopback_udp";
const RULE_ONLINE_LOOPBACK_TCP: &str = "setsuna_sandbox_online_block_loopback_tcp_except_proxy";
const RULE_ONLINE_OTHER_LOOPBACK_TCP: &str = "setsuna_sandbox_online_block_non_proxy_loopback_tcp";
const RULE_NAMES: [&str; 7] = [
    RULE_OFFLINE_NON_LOOPBACK,
    RULE_OFFLINE_LOOPBACK,
    RULE_ONLINE_NON_LOOPBACK,
    RULE_ONLINE_PROXY_ALLOW,
    RULE_ONLINE_LOOPBACK_UDP,
    RULE_ONLINE_LOOPBACK_TCP,
    RULE_ONLINE_OTHER_LOOPBACK_TCP,
];

struct RuleSpec<'a> {
    name: &'a str,
    description: &'a str,
    action: NET_FW_ACTION,
    protocol: i32,
    sid: &'a str,
    remote_addresses: &'a str,
    remote_ports: Option<&'a str>,
}

pub fn install(
    offline_sid: &str,
    online_sid: &str,
    proxy_port_start: u16,
    proxy_port_end: u16,
) -> Result<(), SandboxError> {
    with_rules(|rules| {
        let blocked_online_ports = blocked_port_complement(proxy_port_start, proxy_port_end)?;
        let proxy_ports = allowed_port_range(proxy_port_start, proxy_port_end)?;
        for spec in rule_specs(offline_sid, online_sid, &proxy_ports, &blocked_online_ports) {
            replace_rule(rules, &spec)?;
        }
        Ok(())
    })
}

pub fn verify(
    offline_sid: &str,
    online_sid: &str,
    proxy_port_start: u16,
    proxy_port_end: u16,
) -> Result<(), SandboxError> {
    with_rules(|rules| {
        let blocked_online_ports = blocked_port_complement(proxy_port_start, proxy_port_end)?;
        let proxy_ports = allowed_port_range(proxy_port_start, proxy_port_end)?;
        for spec in rule_specs(offline_sid, online_sid, &proxy_ports, &blocked_online_ports) {
            verify_rule(rules, &spec)?;
        }
        Ok(())
    })
    .map_err(|error| {
        SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!(
                "Windows Firewall sandbox rules need repair: {}",
                error.message
            ),
        )
    })
}

pub fn uninstall() -> Result<(), SandboxError> {
    with_rules(|rules| {
        for name in RULE_NAMES {
            let name_bstr = BSTR::from(name);
            if unsafe { rules.Item(&name_bstr) }.is_ok() {
                unsafe { rules.Remove(&name_bstr) }.map_err(|error| {
                    SandboxError::new(
                        SandboxErrorCode::SetupFailed,
                        format!("cannot remove Windows Firewall rule {name}: {error:?}"),
                    )
                })?;
            }
        }
        Ok(())
    })
}

fn with_rules<T>(
    operation: impl FnOnce(&INetFwRules) -> Result<T, SandboxError>,
) -> Result<T, SandboxError> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok()
        .map_err(|error| {
            SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("CoInitializeEx failed for Windows Firewall: {error:?}"),
            )
        })?;
    let result = unsafe {
        let policy: INetFwPolicy2 = CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| {
                SandboxError::new(
                    SandboxErrorCode::SetupFailed,
                    format!("cannot open Windows Firewall policy: {error:?}"),
                )
            })?;
        ensure_local_policy_effective(&policy)?;
        let rules = policy.Rules().map_err(|error| {
            SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("cannot enumerate Windows Firewall rules: {error:?}"),
            )
        })?;
        operation(&rules)
    };
    unsafe {
        CoUninitialize();
    }
    result
}

fn ensure_local_policy_effective(policy: &INetFwPolicy2) -> Result<(), SandboxError> {
    let mut state = NET_FW_MODIFY_STATE::default();
    let result = unsafe {
        (Interface::vtable(policy).LocalPolicyModifyState)(Interface::as_raw(policy), &mut state)
    };
    if result != S_OK || state != NET_FW_MODIFY_STATE_OK {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!(
                "local Windows Firewall rules are overridden or ineffective: HRESULT={result:?}, state={state:?}"
            ),
        ));
    }
    // A long-running command can survive a network/profile transition. Every
    // profile must therefore be enabled before the sandbox is considered ready.
    for profile in [
        NET_FW_PROFILE2_DOMAIN,
        NET_FW_PROFILE2_PRIVATE,
        NET_FW_PROFILE2_PUBLIC,
    ] {
        let enabled = unsafe { policy.get_FirewallEnabled(profile) }.map_err(|error| {
            SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!(
                    "cannot query Windows Firewall profile {:?}: {error:?}",
                    profile
                ),
            )
        })?;
        if enabled != VARIANT_TRUE {
            return Err(SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!(
                    "Windows Firewall profile {:?} is disabled; sandbox cannot fail closed",
                    profile
                ),
            ));
        }
    }
    Ok(())
}

fn replace_rule(rules: &INetFwRules, spec: &RuleSpec<'_>) -> Result<(), SandboxError> {
    let name = BSTR::from(spec.name);
    if unsafe { rules.Item(&name) }.is_ok() {
        unsafe { rules.Remove(&name) }.map_err(|error| {
            SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("cannot replace firewall rule {}: {error:?}", spec.name),
            )
        })?;
    }
    // Recreate instead of patching by name. A stale rule may carry an application,
    // service, interface, or local-address filter that would silently narrow a
    // block rule even when the fields below look correct.
    let rule: INetFwRule3 = unsafe { CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER) }
        .map_err(|error| {
            SandboxError::new(
                SandboxErrorCode::SetupFailed,
                format!("cannot create firewall rule {}: {error:?}", spec.name),
            )
        })?;
    unsafe { rule.SetName(&name) }.map_err(|error| {
        SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot name firewall rule {}: {error:?}", spec.name),
        )
    })?;
    configure_rule(&rule, spec)?;
    unsafe { rules.Add(&rule) }.map_err(|error| {
        SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot add firewall rule {}: {error:?}", spec.name),
        )
    })?;
    verify_configured_rule(&rule, spec)
}

fn verify_rule(rules: &INetFwRules, spec: &RuleSpec<'_>) -> Result<(), SandboxError> {
    let rule: INetFwRule3 = unsafe { rules.Item(&BSTR::from(spec.name)) }
        .map_err(|_| {
            SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!("missing firewall rule {}", spec.name),
            )
        })?
        .cast()
        .map_err(|error| {
            SandboxError::new(
                SandboxErrorCode::NeedsRepair,
                format!("invalid firewall rule {}: {error:?}", spec.name),
            )
        })?;
    verify_configured_rule(&rule, spec)
}

fn configure_rule(rule: &INetFwRule3, spec: &RuleSpec<'_>) -> Result<(), SandboxError> {
    let local_user = format!("O:LSD:(A;;CC;;;{})", spec.sid);
    unsafe {
        rule.SetDescription(&BSTR::from(spec.description))
            .and_then(|()| rule.SetDirection(NET_FW_RULE_DIR_OUT))
            .and_then(|()| rule.SetAction(spec.action))
            .and_then(|()| rule.SetEnabled(VARIANT_TRUE))
            .and_then(|()| rule.SetProfiles(NET_FW_PROFILE2_ALL.0))
            .and_then(|()| rule.SetProtocol(spec.protocol))
            .and_then(|()| rule.SetRemoteAddresses(&BSTR::from(spec.remote_addresses)))
            .and_then(|()| {
                if let Some(ports) = spec.remote_ports {
                    rule.SetRemotePorts(&BSTR::from(ports))
                } else {
                    Ok(())
                }
            })
            .and_then(|()| rule.SetLocalUserAuthorizedList(&BSTR::from(local_user)))
    }
    .map_err(|error| {
        SandboxError::new(
            SandboxErrorCode::SetupFailed,
            format!("cannot configure firewall rule {}: {error:?}", spec.name),
        )
    })
}

fn verify_configured_rule(rule: &INetFwRule3, spec: &RuleSpec<'_>) -> Result<(), SandboxError> {
    let expected_local_user = format!("O:LSD:(A;;CC;;;{})", spec.sid);
    let (
        enabled,
        direction,
        action,
        profiles,
        protocol,
        local_user,
        remote_addresses,
        remote_ports,
    ) = unsafe {
        (
            rule.Enabled().ok(),
            rule.Direction().ok(),
            rule.Action().ok(),
            rule.Profiles().ok(),
            rule.Protocol().ok(),
            rule.LocalUserAuthorizedList()
                .ok()
                .map(|value| value.to_string()),
            rule.RemoteAddresses().ok().map(|value| value.to_string()),
            rule.RemotePorts().ok().map(|value| value.to_string()),
        )
    };
    let mut mismatches = Vec::new();
    if enabled != Some(VARIANT_TRUE) {
        mismatches.push(format!("enabled={enabled:?}"));
    }
    if direction != Some(NET_FW_RULE_DIR_OUT) {
        mismatches.push(format!("direction={direction:?}"));
    }
    if action != Some(spec.action) {
        mismatches.push(format!("action={action:?}"));
    }
    if profiles != Some(NET_FW_PROFILE2_ALL.0) {
        mismatches.push(format!("profiles={profiles:?}"));
    }
    if protocol != Some(spec.protocol) {
        mismatches.push(format!("protocol={protocol:?}"));
    }
    if local_user.as_deref() != Some(expected_local_user.as_str()) {
        mismatches.push(format!(
            "local-user={local_user:?}, expected={expected_local_user:?}"
        ));
    }
    if remote_addresses.as_deref() != Some(spec.remote_addresses) {
        mismatches.push(format!(
            "remote-addresses={remote_addresses:?}, expected={:?}",
            spec.remote_addresses
        ));
    }
    if let Some(expected_ports) = spec.remote_ports {
        if remote_ports.as_deref() != Some(expected_ports) {
            mismatches.push(format!(
                "remote-ports={remote_ports:?}, expected={expected_ports:?}"
            ));
        }
    }
    if !mismatches.is_empty() {
        return Err(SandboxError::new(
            SandboxErrorCode::NeedsRepair,
            format!(
                "firewall rule {} failed read-back verification: {}",
                spec.name,
                mismatches.join("; ")
            ),
        ));
    }
    Ok(())
}

fn rule_specs<'a>(
    offline_sid: &'a str,
    online_sid: &'a str,
    proxy_ports: &'a str,
    blocked_online_ports: &'a str,
) -> [RuleSpec<'a>; 7] {
    [
        RuleSpec {
            name: RULE_OFFLINE_NON_LOOPBACK,
            description: "Setsuna Sandbox Offline - block non-loopback outbound",
            action: NET_FW_ACTION_BLOCK,
            protocol: NET_FW_IP_PROTOCOL_ANY.0,
            sid: offline_sid,
            remote_addresses: NON_LOOPBACK_ADDRESSES,
            remote_ports: None,
        },
        RuleSpec {
            name: RULE_OFFLINE_LOOPBACK,
            description: "Setsuna Sandbox Offline - block loopback outbound",
            action: NET_FW_ACTION_BLOCK,
            protocol: NET_FW_IP_PROTOCOL_ANY.0,
            sid: offline_sid,
            remote_addresses: LOOPBACK_ADDRESSES,
            remote_ports: None,
        },
        RuleSpec {
            name: RULE_ONLINE_NON_LOOPBACK,
            description: "Setsuna Sandbox Online - block direct non-loopback outbound",
            action: NET_FW_ACTION_BLOCK,
            protocol: NET_FW_IP_PROTOCOL_ANY.0,
            sid: online_sid,
            remote_addresses: NON_LOOPBACK_ADDRESSES,
            remote_ports: None,
        },
        RuleSpec {
            name: RULE_ONLINE_PROXY_ALLOW,
            description: "Setsuna Sandbox Online - allow authenticated loopback proxy range",
            action: NET_FW_ACTION_ALLOW,
            protocol: NET_FW_IP_PROTOCOL_TCP.0,
            sid: online_sid,
            remote_addresses: PROXY_LOOPBACK_ADDRESS,
            remote_ports: Some(proxy_ports),
        },
        RuleSpec {
            name: RULE_ONLINE_LOOPBACK_UDP,
            description: "Setsuna Sandbox Online - block loopback UDP",
            action: NET_FW_ACTION_BLOCK,
            protocol: NET_FW_IP_PROTOCOL_UDP.0,
            sid: online_sid,
            remote_addresses: LOOPBACK_ADDRESSES,
            remote_ports: None,
        },
        RuleSpec {
            name: RULE_ONLINE_LOOPBACK_TCP,
            description: "Setsuna Sandbox Online - block proxy-address TCP except proxy range",
            action: NET_FW_ACTION_BLOCK,
            protocol: NET_FW_IP_PROTOCOL_TCP.0,
            sid: online_sid,
            remote_addresses: PROXY_LOOPBACK_ADDRESS,
            remote_ports: Some(blocked_online_ports),
        },
        RuleSpec {
            name: RULE_ONLINE_OTHER_LOOPBACK_TCP,
            description: "Setsuna Sandbox Online - block non-proxy loopback TCP",
            action: NET_FW_ACTION_BLOCK,
            protocol: NET_FW_IP_PROTOCOL_TCP.0,
            sid: online_sid,
            remote_addresses: NON_PROXY_LOOPBACK_ADDRESSES,
            remote_ports: None,
        },
    ]
}

fn allowed_port_range(start: u16, end: u16) -> Result<String, SandboxError> {
    if start == 0 || end < start {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            "sandbox proxy port range is invalid",
        ));
    }
    Ok(range(u32::from(start), u32::from(end)))
}

fn blocked_port_complement(start: u16, end: u16) -> Result<String, SandboxError> {
    if start == 0 || end < start {
        return Err(SandboxError::new(
            SandboxErrorCode::SetupFailed,
            "sandbox proxy port range is invalid",
        ));
    }
    let mut ranges = Vec::new();
    if start > 1 {
        ranges.push(range(1, u32::from(start) - 1));
    }
    if end < u16::MAX {
        ranges.push(range(u32::from(end) + 1, u32::from(u16::MAX)));
    }
    Ok(ranges.join(","))
}

fn range(start: u32, end: u32) -> String {
    if start == end {
        start.to_string()
    } else {
        format!("{start}-{end}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_range_complement_is_fail_closed() {
        assert_eq!(
            allowed_port_range(61_080, 61_089).expect("valid range"),
            "61080-61089"
        );
        assert_eq!(
            blocked_port_complement(61_080, 61_089).expect("valid range"),
            "1-61079,61090-65535"
        );
    }
}
