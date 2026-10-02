use crate::pipe::Pipe;
use setsuna_computer_windows::protocol::{Failure, Result};
use setsuna_computer_windows::win32::{wide, Handle};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::Com::*;
use windows_sys::Win32::System::Threading::*;
use windows_sys::Win32::UI::Shell::*;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

/// This handle comes from ShellExecuteEx, so cleanup does not need to reopen an
/// elevated process from the unelevated Electron host.
pub struct Elevated {
    pub pipe: Pipe,
    process: Handle,
}
impl Drop for Elevated {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}
impl Elevated {
    pub fn terminate(&self) -> Result<()> {
        // Shutdown acknowledges disarmed input before the process finishes exiting.
        // Let that graceful exit finish instead of racing it with TerminateProcess.
        if unsafe { WaitForSingleObject(self.process.0, 500) } == WAIT_OBJECT_0 {
            return Ok(());
        }
        let terminated = unsafe { TerminateProcess(self.process.0, 0) } != 0;
        let error = Failure::system("Stopping elevated input helper failed");
        if unsafe { WaitForSingleObject(self.process.0, 500) } != WAIT_OBJECT_0 {
            return Err(if terminated {
                Failure::new(
                    "native-failed",
                    "Elevated input helper did not confirm exit.",
                )
            } else {
                error
            });
        }
        Ok(())
    }
}

pub fn launch(executable: std::path::PathBuf, stopped: Arc<AtomicBool>) -> Result<Elevated> {
    let name = format!(r"\\.\pipe\setsuna-computer-{:032x}", rand::random::<u128>());
    let pipe = Pipe::server(&name)?;
    let args = format!("--elevated {name} {}", std::process::id());
    let (sender, receiver) = mpsc::sync_channel(1);
    // UAC can wait for a human. Keep the stdin cancellation path responsive. If
    // consent arrives after cancellation, the pipe is gone and no input can run.
    std::thread::spawn(move || {
        unsafe {
            CoInitializeEx(
                std::ptr::null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            );
        }
        let executable = wide(executable);
        let parameters = wide(args);
        let verb = wide("runas");
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        info.lpVerb = verb.as_ptr();
        info.lpFile = executable.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.nShow = SW_HIDE;
        let result = if unsafe { ShellExecuteExW(&mut info) } == 0 {
            Err(if unsafe { GetLastError() } == ERROR_CANCELLED {
                Failure::new(
                    "elevation-cancelled",
                    "管理员授权已取消，电脑控制已停止；本轮不会再次请求提权。",
                )
            } else {
                Failure::system("Windows administrator authorization failed")
            })
        } else {
            Handle::new(info.hProcess)
        };
        unsafe {
            CoUninitialize();
        }
        if let Err(returned) = sender.send(result) {
            if let Ok(process) = returned.0 {
                unsafe {
                    TerminateProcess(process.0, 0);
                }
            }
        }
    });
    let check = || {
        if stopped.load(Ordering::Acquire) {
            Err(Failure::cancelled())
        } else {
            Ok(())
        }
    };
    let process = loop {
        check()?;
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(result) => break result?,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => {
                return Err(Failure::new(
                    "native-failed",
                    "Administrator authorization worker exited.",
                ))
            }
        }
    };
    let elevated = Elevated { pipe, process };
    check()?;
    elevated
        .pipe
        .accept(unsafe { GetProcessId(elevated.process.0) }, check)?;
    Ok(elevated)
}
