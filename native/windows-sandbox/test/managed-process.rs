#![cfg(windows)]

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows_sys::Win32::System::Console::{GetConsoleCP, GetConsoleOutputCP, GetConsoleWindow};
use windows_sys::Win32::System::StationsAndDesktops::{
    GetThreadDesktop, GetUserObjectInformationW, UOI_NAME,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentThreadId, OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;

const PROBE_MODE: &str = "SETSUNA_TEST_BACKGROUND_PROBE";
const CALLER_DESKTOP: &str = "SETSUNA_TEST_CALLER_DESKTOP";
const EXPECTED_DESKTOP: &str = "SETSUNA_TEST_BACKGROUND_DESKTOP";
const EXPECTED_CONSOLE: &str = "SETSUNA_TEST_CONSOLE_WINDOW";

mod support;
use support::{wait_until, ProcessHandle, RunningChild};

fn probe_command() -> String {
    format!(
        "\"{}\" --exact background_probe --nocapture",
        std::env::current_exe().unwrap().display()
    )
}

fn launcher(mode: &str) -> Command {
    supervised_launcher(mode, &[std::process::id()])
}

fn supervised_launcher(mode: &str, supervisors: &[u32]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_setsuna-sandbox-win"));
    command
        .args([
            "run-managed",
            "--command",
            &probe_command(),
            "--supervisor-pids",
            &supervisors
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(","),
        ])
        .env(PROBE_MODE, mode)
        .env(CALLER_DESKTOP, current_desktop_name())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

#[test]
fn nested_commands_inherit_the_user_desktop_and_preserve_io_and_exit_code() {
    let root = tempfile::tempdir().unwrap();
    let cwd = root.path().join("工作目录 with spaces");
    std::fs::create_dir(&cwd).unwrap();
    let mut child = launcher("parent").current_dir(&cwd).spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all("输入 stdin\n".as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(23), "{output:?}");
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("stdout:输入 stdin"), "{stdout}");
    assert!(
        stdout.contains(&format!("cwd:{}", cwd.display())),
        "{stdout}"
    );
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        "stderr:separate\n"
    );
}

#[test]
fn shell_builtins_preserve_chinese_output_and_exit_code() {
    let output = Command::new(env!("CARGO_BIN_EXE_setsuna-sandbox-win"))
        .args([
            "run-managed",
            "--command",
            "(echo 中文标准输出) & (echo 中文标准错误 1>&2) & exit /b 23",
            "--supervisor-pids",
            &std::process::id().to_string(),
        ])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(23), "{output:?}");
    assert_eq!(
        String::from_utf8(output.stdout).unwrap().trim(),
        "中文标准输出"
    );
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        "中文标准错误"
    );
}

#[test]
fn shell_handoff_preserves_quoting_expansion_and_pipelines() {
    for (command, expected) in [
        ("echo \"one & two\"", "\"one & two\""),
        ("echo %SETSUNA_TEST_VALUE%", "%SETSUNA_TEST_OTHER%"),
        ("echo !SETSUNA_TEST_OTHER!", "!SETSUNA_TEST_OTHER!"),
        ("echo caret ^^ end ^& literal", "caret ^ end & literal"),
        ("(echo 管道中文) | findstr .", "管道中文"),
        ("for %I in (one two) do @echo %I", "one\r\ntwo"),
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_setsuna-sandbox-win"))
            .args([
                "run-managed",
                "--command",
                command,
                "--supervisor-pids",
                &std::process::id().to_string(),
            ])
            .env("SETSUNA_TEST_VALUE", "%SETSUNA_TEST_OTHER%")
            .env("SETSUNA_TEST_OTHER", "unexpected-expansion")
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(output.status.success(), "{command}: {output:?}");
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            expected,
            "{command}"
        );
        assert!(output.stderr.is_empty(), "{command}: {:?}", output.stderr);
    }
}

#[test]
fn killing_the_launcher_terminates_its_descendants() {
    let mut child = RunningChild(launcher("sleep").spawn().unwrap());
    let stdout = child.0.stdout.take().unwrap();
    let pid = BufReader::new(stdout)
        .lines()
        .find_map(|line| {
            line.unwrap()
                .strip_prefix("descendant:")
                .and_then(|value| value.parse::<u32>().ok())
        })
        .expect("descendant did not start");
    let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    assert_ne!(process, 0);
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    let result = unsafe { WaitForSingleObject(process, 5_000) };
    unsafe {
        CloseHandle(process);
    }
    assert_eq!(
        result, WAIT_OBJECT_0,
        "descendant survived launcher cancellation"
    );
}

// This test executable doubles as a console program. The second cmd deliberately
// uses normal startup flags, as package managers do when launching lifecycle scripts.
#[test]
fn background_probe() {
    let Ok(mode) = std::env::var(PROBE_MODE) else {
        return;
    };
    let desktop = current_desktop_name();
    assert_eq!(
        desktop,
        std::env::var(CALLER_DESKTOP).unwrap(),
        "host command must inherit the caller's desktop"
    );
    if let Ok(expected) = std::env::var(EXPECTED_DESKTOP) {
        assert_eq!(
            desktop, expected,
            "nested cmd did not inherit the background desktop"
        );
    }
    if mode == "parent" {
        assert_hidden_console();
        let status = Command::new("cmd.exe")
            .args(["/d", "/s", "/c"])
            .raw_arg(format!("\"{}\"", probe_command()))
            .env(PROBE_MODE, "io")
            .env(EXPECTED_DESKTOP, desktop)
            .env(EXPECTED_CONSOLE, unsafe { GetConsoleWindow() }.to_string())
            .status()
            .unwrap();
        std::process::exit(status.code().unwrap_or(1));
    }
    if mode == "io" {
        assert_hidden_console();
        assert_eq!(unsafe { GetConsoleCP() }, 65001);
        assert_eq!(unsafe { GetConsoleOutputCP() }, 65001);
        assert_eq!(
            unsafe { GetConsoleWindow() }.to_string(),
            std::env::var(EXPECTED_CONSOLE).unwrap(),
            "nested command allocated another console instead of inheriting its parent"
        );
    }
    if mode == "sleep" {
        println!("\ndescendant:{}", std::process::id());
        std::io::stdout().flush().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    if mode == "owner" {
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).unwrap();
        return;
    }
    if mode == "detach" {
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "background_probe", "--nocapture"])
            .env(PROBE_MODE, "descendant")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
            .unwrap();
        std::process::exit(23);
    }
    if mode == "descendant" {
        std::fs::write(
            std::env::var("SETSUNA_TEST_PID_FILE").unwrap(),
            std::process::id().to_string(),
        )
        .unwrap();
        let stop = std::env::var("SETSUNA_TEST_STOP_FILE").unwrap();
        wait_until(|| std::path::Path::new(&stop).exists());
        std::process::exit(0);
    }
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).unwrap();
    println!("stdout:{}", input.trim_end());
    println!("cwd:{}", std::env::current_dir().unwrap().display());
    eprintln!("stderr:separate");
    std::process::exit(23);
}

fn assert_hidden_console() {
    let console = unsafe { GetConsoleWindow() };
    assert!(
        console == 0 || unsafe { IsWindowVisible(console) } == 0,
        "a package-manager child created a visible console"
    );
}

fn detached_tree(root: &std::path::Path, supervisors: &[u32]) -> (RunningChild, ProcessHandle) {
    let pid_file = root.join("child.pid");
    let child = RunningChild(
        supervised_launcher("detach", supervisors)
            .env("SETSUNA_TEST_PID_FILE", &pid_file)
            .env("SETSUNA_TEST_STOP_FILE", root.join("stop"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    wait_until(|| {
        std::fs::read_to_string(&pid_file).is_ok_and(|value| value.parse::<u32>().is_ok())
    });
    let pid = std::fs::read_to_string(&pid_file).unwrap().parse().unwrap();
    (child, ProcessHandle::open(pid))
}

#[test]
fn root_exit_does_not_close_the_job_and_its_exit_code_is_preserved() {
    let root = tempfile::tempdir().unwrap();
    let (mut launcher, descendant) = detached_tree(root.path(), &[std::process::id()]);
    assert!(
        !descendant.exited(300),
        "descendant was killed after root exit"
    );
    assert!(launcher.0.try_wait().unwrap().is_none());
    std::fs::write(root.path().join("stop"), "stop").unwrap();
    wait_until(|| launcher.0.try_wait().unwrap().is_some());
    assert_eq!(launcher.0.wait().unwrap().code(), Some(23));
    assert!(descendant.exited(5_000));
}

#[test]
fn killing_launcher_after_root_exit_still_terminates_the_job() {
    let root = tempfile::tempdir().unwrap();
    let (mut launcher, descendant) = detached_tree(root.path(), &[std::process::id()]);
    assert!(!descendant.exited(300));
    launcher.0.kill().unwrap();
    assert!(descendant.exited(5_000));
}

#[test]
fn owner_exit_and_crash_terminate_descendants_even_after_root_exit() {
    for crash in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let mut owner = RunningChild(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "background_probe", "--nocapture"])
                .env(PROBE_MODE, "owner")
                .env(CALLER_DESKTOP, current_desktop_name())
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x0800_0000)
                .spawn()
                .unwrap(),
        );
        let (mut launcher, descendant) =
            detached_tree(root.path(), &[std::process::id(), owner.0.id()]);
        assert!(!descendant.exited(300));
        if crash {
            owner.0.kill().unwrap();
        } else {
            owner.0.stdin.take().unwrap().write_all(b"exit\n").unwrap();
        }
        assert!(descendant.exited(5_000));
        wait_until(|| launcher.0.try_wait().unwrap().is_some());
        assert!(!launcher.0.wait().unwrap().success());
    }
}

#[test]
fn invalid_or_missing_supervisors_fail_before_running_the_command() {
    for pids in ["", "0", "4294967295", "1,1"] {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join("must-not-exist");
        let output = Command::new(env!("CARGO_BIN_EXE_setsuna-sandbox-win"))
            .args([
                "run-managed",
                "--command",
                &format!("echo bad > \"{}\"", marker.display()),
                "--supervisor-pids",
                pids,
            ])
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(!output.status.success(), "{output:?}");
        assert!(!marker.exists());
    }
}

fn current_desktop_name() -> String {
    let desktop = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
    assert_ne!(desktop, 0);
    let mut name = [0_u16; 256];
    let mut needed = 0;
    let result = unsafe {
        GetUserObjectInformationW(
            desktop,
            UOI_NAME,
            name.as_mut_ptr().cast(),
            std::mem::size_of_val(&name) as u32,
            &mut needed,
        )
    };
    assert_ne!(result, 0, "{}", std::io::Error::last_os_error());
    let end = name
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(name.len());
    String::from_utf16(&name[..end]).unwrap()
}
