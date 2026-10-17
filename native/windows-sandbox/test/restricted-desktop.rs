use super::spawn_restricted_shell;
use crate::protocol::{PermissionProfile, SandboxRunRequest};
use std::process::Command;
use windows_sys::Win32::System::StationsAndDesktops::{
    GetThreadDesktop, GetUserObjectInformationW, UOI_NAME,
};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;

const MODE: &str = "SETSUNA_TEST_RESTRICTED_DESKTOP";
const CALLER: &str = "SETSUNA_TEST_HOST_DESKTOP";
const PREFIX: &str = "platform::windows::process::desktop_tests";

#[test]
fn restricted_shell_uses_a_private_desktop() {
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            &format!("{PREFIX}::restricted_launcher"),
            "--nocapture",
        ])
        .env(MODE, "launcher")
        .env(CALLER, desktop_name())
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("restricted desktop verified"),
        "{output:?}"
    );
}

// Exercise the real token/desktop creation path in a child with valid pipes.
// This does not install or alter machine-wide sandbox accounts or ACLs.
#[test]
fn restricted_launcher() {
    if std::env::var(MODE).as_deref() != Ok("launcher") {
        return;
    }
    let cwd = std::env::current_dir().unwrap();
    let mut environment = std::env::vars().collect::<std::collections::BTreeMap<_, _>>();
    environment.insert(MODE.to_string(), "probe".to_string());
    let request = SandboxRunRequest {
        protocol_version: 1,
        execution_id: "desktop-test".to_string(),
        supervisor_pids: vec![std::process::id()],
        command: format!(
            "\"{}\" --exact {PREFIX}::restricted_probe --nocapture",
            std::env::current_exe().unwrap().display()
        ),
        cwd: cwd.clone(),
        workspace_root: cwd,
        permission_profile: PermissionProfile::ReadOnly,
        readable_roots: vec![],
        writable_roots: vec![],
        ephemeral_writable_roots: vec![],
        denied_roots: vec![],
        denied_glob_reg_exp_sources: vec![],
        protected_writable_roots: vec![],
        network_access: false,
        environment,
    };
    assert_eq!(spawn_restricted_shell(&request, "S-1-1-0").unwrap(), 0);
}

#[test]
fn restricted_probe() {
    if std::env::var(MODE).as_deref() != Ok("probe") {
        return;
    }
    let desktop = desktop_name();
    assert!(desktop.starts_with("SetsunaSandbox-"), "{desktop}");
    assert_ne!(desktop, std::env::var(CALLER).unwrap());
    println!("restricted desktop verified");
}

fn desktop_name() -> String {
    let mut name = [0_u16; 256];
    let mut needed = 0;
    assert_ne!(
        unsafe {
            GetUserObjectInformationW(
                GetThreadDesktop(GetCurrentThreadId()),
                UOI_NAME,
                name.as_mut_ptr().cast(),
                std::mem::size_of_val(&name) as u32,
                &mut needed,
            )
        },
        0
    );
    String::from_utf16(&name[..name.iter().position(|value| *value == 0).unwrap()]).unwrap()
}
