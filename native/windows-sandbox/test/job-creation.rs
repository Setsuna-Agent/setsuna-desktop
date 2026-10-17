use super::super::handle::OwnedHandle;
use super::super::wide::{quote_windows_argument, to_wide};
use super::JobObject;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
use windows_sys::Win32::System::JobObjects::IsProcessInJob;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, CreateProcessWithLogonW, OpenProcess, ResumeThread, TerminateProcess,
    WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
    EXTENDED_STARTUPINFO_PRESENT, LOGON_NETCREDENTIALS_ONLY, PROCESS_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, STARTUPINFOW,
};

const MARKER: &str = "SETSUNA_TEST_LOGON_CHILD_PID";

#[test]
fn logon_child_inherits_broker_job_before_explicit_assignment() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("child.pid");
    let mut environment = std::env::vars().collect::<std::collections::BTreeMap<_, _>>();
    environment.insert(MARKER.to_string(), marker.to_string_lossy().into_owned());
    let mut block = Vec::<u16>::new();
    for (key, value) in environment {
        block.extend(to_wide(format!("{key}={value}")));
    }
    block.push(0);
    let executable = std::env::current_exe().unwrap();
    let mut command = to_wide(format!(
        "{} --exact platform::windows::job::creation_tests::logon_broker --nocapture",
        quote_windows_argument(&executable.to_string_lossy())
    ));
    let job = JobObject::create().unwrap();
    let attributes = job.process_attributes().unwrap();
    let startup = attributes.startup_info();
    let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let created = unsafe {
        CreateProcessW(
            to_wide(executable.as_os_str()).as_ptr(),
            command.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            CREATE_NO_WINDOW
                | CREATE_SUSPENDED
                | CREATE_UNICODE_ENVIRONMENT
                | EXTENDED_STARTUPINFO_PRESENT,
            block.as_ptr().cast(),
            std::ptr::null(),
            &startup.StartupInfo,
            &mut info,
        )
    };
    assert_ne!(created, 0, "{}", std::io::Error::last_os_error());
    let broker = OwnedHandle::new(info.hProcess).unwrap();
    let thread = OwnedHandle::new(info.hThread).unwrap();
    unsafe {
        ResumeThread(thread.raw());
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    let value = loop {
        if let Ok(value) = std::fs::read_to_string(&marker) {
            if !value.is_empty() {
                break value;
            }
        }
        assert!(
            Instant::now() < deadline,
            "logon broker did not publish its child"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    let pid = value.parse::<u32>().unwrap_or_else(|_| panic!("{value}"));
    let child = OwnedHandle::new(unsafe {
        OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            0,
            pid,
        )
    })
    .unwrap();
    let mut member = 0;
    assert_ne!(
        unsafe { IsProcessInJob(child.raw(), job.handle.raw(), &mut member) },
        0
    );
    // No explicit AssignProcessToJobObject ran in the broker. Killing its owner
    // must collect the cross-logon child, even while it remains suspended.
    job.terminate(1).unwrap();
    if member == 0 {
        // A failing inheritance regression must not leave a suspended test child.
        unsafe {
            TerminateProcess(child.raw(), 1);
        }
    }
    assert_eq!(
        unsafe { WaitForSingleObject(child.raw(), 5_000) },
        WAIT_OBJECT_0
    );
    assert_eq!(
        unsafe { WaitForSingleObject(broker.raw(), 5_000) },
        WAIT_OBJECT_0
    );
    assert_ne!(member, 0, "logon process escaped the creation-time Job");
}

#[test]
fn logon_broker() {
    let Ok(marker) = std::env::var(MARKER) else {
        return;
    };
    let executable = to_wide(
        std::path::Path::new(&std::env::var("SystemRoot").unwrap())
            .join("System32/cmd.exe")
            .as_os_str(),
    );
    let mut command = to_wide("cmd.exe /d /c exit 0");
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // Dummy network-only credentials are not authenticated and do not change
    // local identity, accounts, or firewall configuration.
    let created = unsafe {
        CreateProcessWithLogonW(
            to_wide("setsuna-test").as_ptr(),
            to_wide(".").as_ptr(),
            to_wide("unused-test-credential").as_ptr(),
            LOGON_NETCREDENTIALS_ONLY,
            executable.as_ptr(),
            command.as_mut_ptr(),
            CREATE_NO_WINDOW | CREATE_SUSPENDED,
            std::ptr::null(),
            std::ptr::null(),
            &startup,
            &mut info,
        )
    };
    let result = if created == 0 {
        std::io::Error::last_os_error().to_string()
    } else {
        info.dwProcessId.to_string()
    };
    std::fs::write(marker, result).unwrap();
    std::thread::sleep(Duration::from_secs(30));
}
