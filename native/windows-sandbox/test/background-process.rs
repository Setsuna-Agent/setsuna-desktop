#![cfg(windows)]

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows_sys::Win32::System::StationsAndDesktops::{
    GetThreadDesktop, GetUserObjectInformationW, UOI_NAME,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentThreadId, OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};

const PROBE_MODE: &str = "SETSUNA_TEST_BACKGROUND_PROBE";
const CALLER_DESKTOP: &str = "SETSUNA_TEST_CALLER_DESKTOP";
const EXPECTED_DESKTOP: &str = "SETSUNA_TEST_BACKGROUND_DESKTOP";

fn probe_command() -> String {
    format!(
        "\"{}\" --exact background_probe --nocapture",
        std::env::current_exe().unwrap().display()
    )
}

fn launcher(mode: &str) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_setsuna-sandbox-win"));
    command
        .args(["run-background", "--command", &probe_command()])
        .env(PROBE_MODE, mode)
        .env(CALLER_DESKTOP, current_desktop_name())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

#[test]
fn nested_commands_stay_on_a_separate_desktop_and_preserve_io_and_exit_code() {
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

struct RunningChild(Child);

impl Drop for RunningChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
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
    assert_ne!(
        desktop,
        std::env::var(CALLER_DESKTOP).unwrap(),
        "background command can create windows on the caller's desktop"
    );
    if let Ok(expected) = std::env::var(EXPECTED_DESKTOP) {
        assert_eq!(
            desktop, expected,
            "nested cmd did not inherit the background desktop"
        );
    }
    if mode == "parent" {
        let status = Command::new("cmd.exe")
            .args(["/d", "/s", "/c"])
            .raw_arg(format!("\"{}\"", probe_command()))
            .env(PROBE_MODE, "io")
            .env(EXPECTED_DESKTOP, desktop)
            .status()
            .unwrap();
        std::process::exit(status.code().unwrap_or(1));
    }
    if mode == "sleep" {
        println!("\ndescendant:{}", std::process::id());
        std::io::stdout().flush().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).unwrap();
    println!("stdout:{}", input.trim_end());
    println!("cwd:{}", std::env::current_dir().unwrap().display());
    eprintln!("stderr:separate");
    std::process::exit(23);
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
