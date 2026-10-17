use std::process::Child;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};

pub struct RunningChild(pub Child);

impl Drop for RunningChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub struct ProcessHandle(HANDLE);

impl ProcessHandle {
    pub fn open(pid: u32) -> Self {
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert_ne!(handle, 0, "cannot open process {pid}");
        Self(handle)
    }

    pub fn exited(&self, timeout: u32) -> bool {
        unsafe { WaitForSingleObject(self.0, timeout) == WAIT_OBJECT_0 }
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "process condition timed out");
        std::thread::sleep(Duration::from_millis(20));
    }
}
