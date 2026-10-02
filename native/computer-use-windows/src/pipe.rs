use setsuna_computer_windows::protocol::{Failure, Result, MAX_MESSAGE_BYTES};
use setsuna_computer_windows::win32::{wide, Handle};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Storage::FileSystem::*;
use windows_sys::Win32::System::Pipes::*;

pub struct Pipe {
    handle: Handle,
    buffered: Vec<u8>,
}
impl Pipe {
    pub fn server(name: &str) -> Result<Self> {
        let handle = Handle::new(unsafe {
            CreateNamedPipeW(
                wide(name).as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65536,
                65536,
                0,
                std::ptr::null(),
            )
        })?;
        Ok(Self {
            handle,
            buffered: Vec::new(),
        })
    }
    pub fn client(name: &str, broker_pid: u32) -> Result<Self> {
        if !name.starts_with(r"\\.\pipe\setsuna-computer-") {
            return Err(Failure::new("invalid-peer", "Invalid input pipe name."));
        }
        let handle = Handle::new(unsafe {
            CreateFileW(
                wide(name).as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                0,
            )
        })?;
        let mut server_pid = 0;
        if unsafe { GetNamedPipeServerProcessId(handle.0, &mut server_pid) } == 0
            || server_pid != broker_pid
        {
            return Err(Failure::new(
                "invalid-peer",
                "Desktop broker identity does not match.",
            ));
        }
        let mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
        if unsafe { SetNamedPipeHandleState(handle.0, &mode, std::ptr::null(), std::ptr::null()) }
            == 0
        {
            return Err(Failure::system("Setting input pipe mode failed"));
        }
        Ok(Self {
            handle,
            buffered: Vec::new(),
        })
    }
    pub fn accept(&self, expected_pid: u32, check: impl Fn() -> Result<()>) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            check()?;
            let connected = unsafe { ConnectNamedPipe(self.handle.0, std::ptr::null_mut()) } != 0;
            let error = unsafe { GetLastError() };
            if connected || error == ERROR_PIPE_CONNECTED {
                let mut pid = 0;
                if unsafe { GetNamedPipeClientProcessId(self.handle.0, &mut pid) } == 0
                    || pid != expected_pid
                {
                    return Err(Failure::new(
                        "invalid-peer",
                        "Elevated input helper identity does not match.",
                    ));
                }
                return Ok(());
            }
            if error != ERROR_PIPE_LISTENING || Instant::now() >= deadline {
                return Err(Failure::system("Connecting elevated input helper failed"));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    pub fn connected(&self) -> Result<()> {
        if unsafe {
            PeekNamedPipe(
                self.handle.0,
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(Failure::cancelled());
        }
        Ok(())
    }
    pub fn has_pending_request(&self) -> Result<bool> {
        let mut available = 0;
        if unsafe {
            PeekNamedPipe(
                self.handle.0,
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(Failure::cancelled());
        }
        Ok(available != 0 || !self.buffered.is_empty())
    }
    pub fn write(&self, line: &[u8], check: impl Fn() -> Result<()>) -> Result<()> {
        if line.len() > MAX_MESSAGE_BYTES {
            return Err(Failure::new(
                "invalid-input",
                "Input message exceeds its limit.",
            ));
        }
        let mut offset = 0;
        let deadline = Instant::now() + Duration::from_secs(2);
        while offset < line.len() {
            check()?;
            let mut sent = 0;
            if unsafe {
                WriteFile(
                    self.handle.0,
                    line[offset..].as_ptr(),
                    (line.len() - offset) as u32,
                    &mut sent,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(Failure::system("Writing input pipe failed"));
            }
            offset += sent as usize;
            if Instant::now() >= deadline {
                return Err(Failure::new("timeout", "Input pipe write timed out."));
            }
            if sent == 0 {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        Ok(())
    }
    pub fn read(
        &mut self,
        timeout: Option<Duration>,
        check: impl Fn() -> Result<()>,
    ) -> Result<Vec<u8>> {
        let started = Instant::now();
        loop {
            check()?;
            if let Some(end) = self.buffered.iter().position(|b| *b == b'\n') {
                return Ok(self.buffered.drain(..=end).collect());
            }
            if self.buffered.len() > MAX_MESSAGE_BYTES {
                return Err(Failure::new(
                    "invalid-input",
                    "Input message exceeds its limit.",
                ));
            }
            let mut data = [0u8; 4096];
            let mut read = 0;
            let ok = unsafe {
                ReadFile(
                    self.handle.0,
                    data.as_mut_ptr(),
                    data.len() as u32,
                    &mut read,
                    std::ptr::null_mut(),
                )
            } != 0;
            if !ok && unsafe { GetLastError() } != ERROR_NO_DATA {
                return Err(Failure::system("Reading input pipe failed"));
            }
            self.buffered.extend_from_slice(&data[..read as usize]);
            if timeout.is_some_and(|limit| started.elapsed() > limit) {
                return Err(Failure::new("timeout", "Elevated input helper timed out."));
            }
            if read == 0 {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}
