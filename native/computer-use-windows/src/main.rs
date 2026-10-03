#![windows_subsystem = "windows"]
mod elevation;
mod pipe;

use serde_json::{json, Value};
use setsuna_computer_windows::{
    input,
    protocol::{Command, Failure, Reply, Request, Result, MAX_MESSAGE_BYTES},
    win32::{integrity, Handle},
};
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

fn parse(bytes: &[u8]) -> Result<Request> {
    serde_json::from_slice(bytes)
        .map_err(|_| Failure::new("invalid-input", "Invalid desktop helper request."))
}
fn encoded(reply: &Reply) -> Vec<u8> {
    let mut value = serde_json::to_vec(reply).expect("serializable reply");
    value.push(b'\n');
    value
}
fn execute(command: &Command, active: &mut bool, check: impl Fn() -> Result<()>) -> Result<Value> {
    if matches!(command, Command::Shutdown {} | Command::EndSession {}) {
        *active = false;
        return Ok(json!({"stopped": true}));
    }
    check()?;
    match command {
        Command::Probe {} => Ok(
            json!({"protocolVersion": 1, "integrityLevel": integrity(None)?, "pid": std::process::id()}),
        ),
        Command::Authorize {} if !*active => {
            let level = integrity(None)?;
            if level < 0x3000 {
                return Err(Failure::new(
                    "elevation-required",
                    "Administrator authorization requested.",
                ));
            }
            // Granting permission never opens an input session.
            Ok(json!({"authorized": true, "integrityLevel": level}))
        }
        Command::Start { elevate } if !*active => {
            let level = integrity(None)?;
            if *elevate && level < 0x3000 {
                return Err(Failure::new(
                    "elevation-required",
                    "Administrator authorization is required before starting desktop control.",
                ));
            }
            *active = true;
            Ok(json!({"ready": true, "integrityLevel": level}))
        }
        Command::Action { action, frame } if *active => {
            input::dispatch(action, frame, check)?;
            Ok(json!({"dispatched": true}))
        }
        _ => Err(Failure::new(
            "invalid-session",
            "Desktop helper has no matching active session.",
        )),
    }
}

fn broker() -> Result<()> {
    let stopped = Arc::new(AtomicBool::new(false));
    let reader_stopped = stopped.clone();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(std::io::stdin());
        loop {
            let mut line = Vec::new();
            // A bounded reader prevents untrusted IPC from allocating indefinitely.
            let read = std::io::Read::take(&mut reader, MAX_MESSAGE_BYTES as u64 + 1)
                .read_until(b'\n', &mut line);
            if !matches!(read, Ok(n) if n > 0 && n <= MAX_MESSAGE_BYTES && line.ends_with(b"\n")) {
                break;
            }
            let request = match parse(&line) {
                Ok(request) => request,
                Err(_) => break,
            };
            let shutdown = matches!(request.command, Command::Shutdown {});
            if shutdown {
                reader_stopped.store(true, Ordering::Release);
            }
            if sender.send((request, line)).is_err() || shutdown {
                return;
            }
        }
        reader_stopped.store(true, Ordering::Release);
    });
    let check = || {
        if stopped.load(Ordering::Acquire) {
            Err(Failure::cancelled())
        } else {
            Ok(())
        }
    };
    let mut active = false;
    let mut elevated: Option<elevation::Elevated> = None;
    for (request, line) in receiver {
        let result = (|| -> Result<Value> {
            if matches!(request.command, Command::Shutdown {}) {
                if let Some(mut helper) = elevated.take() {
                    helper.pipe.write(&line, || Ok(()))?;
                    // Drain an in-flight action reply without mistaking it for the stop ack.
                    let deadline = std::time::Instant::now() + Duration::from_secs(1);
                    let reply = loop {
                        let reply: Reply = serde_json::from_slice(&helper.pipe.read(
                            Some(deadline.saturating_duration_since(std::time::Instant::now())),
                            || Ok(()),
                        )?)
                        .map_err(|_| {
                            Failure::new("native-failed", "Invalid elevated shutdown reply.")
                        })?;
                        if reply.id == request.id {
                            break reply;
                        }
                    };
                    if reply.id != request.id
                        || reply
                            .result
                            .as_ref()
                            .and_then(|v| v.get("stopped"))
                            .and_then(Value::as_bool)
                            != Some(true)
                    {
                        return Err(Failure::new(
                            "native-failed",
                            "Elevated input release was not confirmed.",
                        ));
                    }
                    helper.terminate()?;
                }
                Ok(json!({"stopped": true}))
            } else if let Some(helper) = elevated.as_mut() {
                helper
                    .pipe
                    .write(&line, check)
                    .and_then(|()| helper.pipe.read(Some(Duration::from_secs(10)), check))
                    .and_then(|bytes| {
                        let reply: Reply = serde_json::from_slice(&bytes).map_err(|_| {
                            Failure::new("native-failed", "Invalid elevated input reply.")
                        })?;
                        if reply.id != request.id {
                            return Err(Failure::new(
                                "native-failed",
                                "Elevated input reply identity mismatch.",
                            ));
                        }
                        if let Some(message) = reply.error {
                            let code = match reply.error_code.as_deref() {
                                Some("stale-observation") => "stale-observation",
                                Some("input-rejected") => "input-rejected",
                                Some("cancelled") => "cancelled",
                                _ => "native-failed",
                            };
                            Err(Failure::new(code, message))
                        } else {
                            reply.result.ok_or_else(|| {
                                Failure::new("native-failed", "Missing elevated input result.")
                            })
                        }
                    })
            } else {
                let result = execute(&request.command, &mut active, check);
                if matches!(&result, Err(error) if error.code == "elevation-required") {
                    // The executable is fixed by the broker, never by IPC.
                    let executable = std::env::current_exe()
                        .map_err(|_| Failure::system("Resolving desktop helper failed"))?;
                    let mut helper = elevation::launch(executable, stopped.clone())?;
                    let authorizing = matches!(request.command, Command::Authorize {});
                    let startup = if authorizing {
                        b"{\"id\":0,\"kind\":\"authorize\"}\n".as_slice()
                    } else {
                        b"{\"id\":0,\"kind\":\"start\",\"elevate\":true}\n".as_slice()
                    };
                    helper.pipe.write(startup, check)?;
                    let reply: Reply = serde_json::from_slice(
                        &helper.pipe.read(Some(Duration::from_secs(10)), check)?,
                    )
                    .map_err(|_| {
                        Failure::new("native-failed", "Invalid elevated startup reply.")
                    })?;
                    let ready = reply
                        .result
                        .filter(|value| {
                            reply.id == 0
                                && value
                                    .get(if authorizing { "authorized" } else { "ready" })
                                    .and_then(Value::as_bool)
                                    == Some(true)
                                && value
                                    .get("integrityLevel")
                                    .and_then(Value::as_u64)
                                    .is_some_and(|level| level >= 0x3000)
                        })
                        .ok_or_else(|| {
                            Failure::new("native-failed", "Elevated helper did not start.")
                        })?;
                    elevated = Some(helper);
                    if matches!(
                        request.command,
                        Command::Start { .. } | Command::Authorize {}
                    ) {
                        // Starting grants no input: Electron captures the first observation
                        // only after this elevated readiness acknowledgement.
                        Ok(ready)
                    } else {
                        Err(Failure::new("stale-observation", "管理员权限已获得，尚未执行原操作。请根据返回的新截图重新选择操作；不要直接重放旧坐标或文本。"))
                    }
                } else {
                    result
                }
            }
        })();
        std::io::stdout()
            .write_all(&encoded(&Reply::from_result(request.id, result)))
            .map_err(|_| Failure::system("Writing reply failed"))?;
        std::io::stdout()
            .flush()
            .map_err(|_| Failure::system("Flushing reply failed"))?;
        if matches!(request.command, Command::Shutdown {}) {
            return Ok(());
        }
    }
    Ok(())
}

fn elevated(name: &str, broker_pid: u32) -> Result<()> {
    if integrity(None)? < 0x3000 {
        return Err(Failure::new(
            "native-failed",
            "Administrator input helper is not elevated.",
        ));
    }
    let parent = Handle::new(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, broker_pid) })?;
    let mut pipe = pipe::Pipe::client(name, broker_pid)?;
    let parent_alive = || {
        if unsafe { WaitForSingleObject(parent.0, 0) } == WAIT_TIMEOUT {
            Ok(())
        } else {
            Err(Failure::cancelled())
        }
    };
    let mut active = false;
    loop {
        let request = parse(&pipe.read(None, parent_alive)?)?;
        let result = execute(&request.command, &mut active, || {
            parent_alive()?;
            pipe.connected()?;
            // Actions are serialized. A request arriving during input is shutdown.
            if pipe.has_pending_request()? {
                return Err(Failure::cancelled());
            }
            Ok(())
        });
        pipe.write(
            &encoded(&Reply::from_result(request.id, result)),
            parent_alive,
        )?;
        if matches!(request.command, Command::Shutdown {}) {
            return Ok(());
        }
    }
}

fn main() {
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let args: Vec<_> = std::env::args().skip(1).collect();
    let result = match args.as_slice() {
        [] => broker(),
        [mode, pipe, pid] if mode == "--elevated" => pid
            .parse()
            .map_err(|_| Failure::new("invalid-peer", "Invalid broker PID."))
            .and_then(|pid| elevated(pipe, pid)),
        _ => Err(Failure::new(
            "invalid-input",
            "Unsupported desktop helper invocation.",
        )),
    };
    if result.is_err() {
        std::process::exit(1);
    }
}
