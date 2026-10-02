// OS transport tests never send keyboard or mouse input.
#[path = "../src/pipe.rs"]
mod pipe;

use serde_json::json;
use setsuna_computer_windows::protocol::Reply;
use setsuna_computer_windows::win32::Handle;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};

#[test]
fn named_pipe_authenticates_both_process_ids_and_delivers_bounded_messages() {
    let name = format!(r"\\.\pipe\setsuna-computer-{:032x}", rand::random::<u128>());
    let mut server = pipe::Pipe::server(&name).unwrap();
    let name_copy = name.clone();
    let peer = std::thread::spawn(move || {
        let mut client = pipe::Pipe::client(&name_copy, std::process::id()).unwrap();
        client.connected().unwrap();
        client.write(b"probe\n", || Ok(())).unwrap();
        assert_eq!(
            client
                .read(Some(Duration::from_secs(2)), || Ok(()))
                .unwrap(),
            b"ack\n"
        );
    });
    server.accept(std::process::id(), || Ok(())).unwrap();
    assert_eq!(
        server
            .read(Some(Duration::from_secs(2)), || Ok(()))
            .unwrap(),
        b"probe\n"
    );
    assert!(!server.has_pending_request().unwrap());
    server.write(b"ack\n", || Ok(())).unwrap();
    peer.join().unwrap();
    let wrong_name = format!(r"\\.\pipe\setsuna-computer-{:032x}", rand::random::<u128>());
    let _wrong_server = pipe::Pipe::server(&wrong_name).unwrap();
    assert!(pipe::Pipe::client(&wrong_name, std::process::id() + 1).is_err());
}

#[test]
#[ignore = "Manual UAC verification: approve the Windows prompt; no desktop input is sent"]
fn uac_authorizes_only_the_helper_and_it_stops_afterwards() {
    // Exercise Settings authorization, idle admission and reuse through the broker.
    // Killing the broker on test failure also revokes its elevated child.
    struct Guard(Child);
    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut child = Guard(
        Command::new(env!("CARGO_BIN_EXE_setsuna-computer-win"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let mut input = child.0.stdin.take().unwrap();
    let output = child.0.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            if send.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let mut elevated_process = None;
    let mut elevated_pid = None;
    // Invalid geometry makes this admission probe incapable of dispatching input
    // even if a bug accidentally leaves the native session active.
    let denied_action = json!({"kind":"action","action":{"kind":"click","x":0,"y":0},
        "frame":{"width":0,"height":0,"screenWidth":0,"screenHeight":0}});
    for (id, mut request) in [
        json!({"kind":"authorize"}),
        denied_action.clone(),
        json!({"kind":"probe"}),
        json!({"kind":"start","elevate":true}),
        json!({"kind":"end-session"}),
        denied_action,
        json!({"kind":"probe"}),
        json!({"kind":"start","elevate":true}),
        json!({"kind":"end-session"}),
        json!({"kind":"shutdown"}),
    ]
    .into_iter()
    .enumerate()
    {
        request["id"] = json!(id);
        writeln!(input, "{request}").unwrap();
        input.flush().unwrap();
        let line = receive
            .recv_timeout(Duration::from_secs(120))
            .unwrap_or_else(|error| panic!("No reply to {}: {error}", request["kind"]));
        let reply: Reply = serde_json::from_str(&line).unwrap();
        assert_eq!(reply.id, request["id"].as_u64().unwrap());
        if request["kind"] == "action" {
            assert!(reply.error.unwrap().contains("no matching active session"));
            continue;
        }
        assert!(reply.error.is_none(), "{:?}", reply.error);
        let value = reply.result.unwrap();
        if request["kind"] == "start" || request["kind"] == "authorize" {
            assert_eq!(
                value[if request["kind"] == "authorize" {
                    "authorized"
                } else {
                    "ready"
                }],
                true
            );
            assert!(value["integrityLevel"].as_u64().unwrap() >= 0x3000);
        } else if request["kind"] == "probe" {
            assert!(value["integrityLevel"].as_u64().unwrap() >= 0x3000);
            let pid = value["pid"].as_u64().unwrap() as u32;
            assert_ne!(pid, child.0.id());
            if let Some(previous) = elevated_pid {
                assert_eq!(pid, previous);
            }
            elevated_pid = Some(pid);
            elevated_process =
                Some(Handle::new(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) }).unwrap());
        } else {
            assert_eq!(value["stopped"], true);
        }
    }
    assert_eq!(
        unsafe { WaitForSingleObject(elevated_process.unwrap().0, 1000) },
        WAIT_OBJECT_0
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Broker failed to stop"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
