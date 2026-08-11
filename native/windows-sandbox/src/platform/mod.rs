#[cfg(not(windows))]
mod unsupported;
#[cfg(windows)]
mod windows;

#[cfg(not(windows))]
pub use unsupported::*;
#[cfg(windows)]
pub use windows::*;
