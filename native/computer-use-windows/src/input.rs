use crate::protocol::{Action, Direction, Failure, Frame, Modifier, Result};
use crate::win32::integrity;
use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

pub fn physical_point(frame: &Frame, x: u32, y: u32) -> Result<(i32, i32)> {
    if frame.width == 0
        || frame.height == 0
        || frame.screen_width == 0
        || frame.screen_height == 0
        || [
            frame.width,
            frame.height,
            frame.screen_width,
            frame.screen_height,
        ]
        .iter()
        .any(|n| *n > 32768)
        || x >= frame.width
        || y >= frame.height
    {
        return Err(Failure::new(
            "invalid-input",
            "Input coordinates or display dimensions are invalid.",
        ));
    }
    Ok((
        (u64::from(x) * u64::from(frame.screen_width) / u64::from(frame.width)) as i32,
        (u64::from(y) * u64::from(frame.screen_height) / u64::from(frame.height)) as i32,
    ))
}

fn mouse(x: i32, y: i32, flags: u32, data: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: x,
                dy: y,
                mouseData: data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
fn key(code: u16, flags: u32, unicode: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: if unicode { 0 } else { code },
                wScan: if unicode { code } else { 0 },
                dwFlags: flags | if unicode { KEYEVENTF_UNICODE } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
fn modifier_code(modifier: &Modifier) -> u16 {
    match modifier {
        Modifier::Meta => VK_LWIN,
        Modifier::Control => VK_CONTROL,
        Modifier::Alt => VK_MENU,
        Modifier::Shift => VK_SHIFT,
    }
}
fn key_code(name: &str) -> Result<u16> {
    Ok(match name {
        "Tab" => VK_TAB,
        "Enter" => VK_RETURN,
        "Escape" => VK_ESCAPE,
        "Backspace" => VK_BACK,
        "Delete" => VK_DELETE,
        "ArrowUp" => VK_UP,
        "ArrowDown" => VK_DOWN,
        "ArrowLeft" => VK_LEFT,
        "ArrowRight" => VK_RIGHT,
        "Home" => VK_HOME,
        "End" => VK_END,
        "PageUp" => VK_PRIOR,
        "PageDown" => VK_NEXT,
        "Space" => VK_SPACE,
        _ if name.len() == 1 && name.as_bytes()[0].is_ascii_alphanumeric() => {
            u16::from(name.as_bytes()[0].to_ascii_uppercase())
        }
        _ => return Err(Failure::new("invalid-input", "Unsupported desktop key.")),
    })
}

/// Each batch contains complete down/up gestures, so cancellation never splits one.
pub fn batches(action: &Action, frame: &Frame) -> Result<Vec<Vec<INPUT>>> {
    let pointer = |x, y| -> Result<INPUT> {
        let (x, y) = physical_point(frame, x, y)?;
        // Aim at the pixel centre in the primary display's normalized 16-bit space.
        Ok(mouse(
            ((i64::from(x) * 2 + 1) * 65536 / (i64::from(frame.screen_width) * 2)) as i32,
            ((i64::from(y) * 2 + 1) * 65536 / (i64::from(frame.screen_height) * 2)) as i32,
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
            0,
        ))
    };
    match action {
        Action::Click { x, y } => Ok(vec![vec![
            pointer(*x, *y)?,
            mouse(0, 0, MOUSEEVENTF_LEFTDOWN, 0),
            mouse(0, 0, MOUSEEVENTF_LEFTUP, 0),
        ]]),
        Action::Scroll {
            x,
            y,
            direction,
            amount,
        } => {
            if !(1..=10).contains(amount) {
                return Err(Failure::new("invalid-input", "Invalid scroll amount."));
            }
            let delta = match direction {
                Direction::Up => WHEEL_DELTA as i32,
                Direction::Down => -(WHEEL_DELTA as i32),
            };
            Ok(vec![vec![
                pointer(*x, *y)?,
                mouse(0, 0, MOUSEEVENTF_WHEEL, delta * *amount as i32),
            ]])
        }
        Action::Key {
            key: name,
            modifiers,
        } => {
            if modifiers.len() > 4
                || modifiers
                    .iter()
                    .enumerate()
                    .any(|(i, m)| modifiers[..i].contains(m))
            {
                return Err(Failure::new("invalid-input", "Invalid keyboard modifiers."));
            }
            let code = key_code(name)?;
            let extended = if [
                VK_DELETE, VK_UP, VK_DOWN, VK_LEFT, VK_RIGHT, VK_HOME, VK_END, VK_PRIOR, VK_NEXT,
            ]
            .contains(&code)
            {
                KEYEVENTF_EXTENDEDKEY
            } else {
                0
            };
            let mut events: Vec<_> = modifiers
                .iter()
                .map(|m| key(modifier_code(m), 0, false))
                .collect();
            events.extend([
                key(code, extended, false),
                key(code, extended | KEYEVENTF_KEYUP, false),
            ]);
            events.extend(
                modifiers
                    .iter()
                    .rev()
                    .map(|m| key(modifier_code(m), KEYEVENTF_KEYUP, false)),
            );
            Ok(vec![events])
        }
        Action::Type { text } => {
            if text.is_empty() || text.encode_utf16().count() > 2000 {
                return Err(Failure::new(
                    "invalid-input",
                    "Invalid desktop text length.",
                ));
            }
            Ok(text
                .chars()
                .map(|character| {
                    character
                        .encode_utf16(&mut [0u16; 2])
                        .iter()
                        .flat_map(|unit| [key(*unit, 0, true), key(*unit, KEYEVENTF_KEYUP, true)])
                        .collect()
                })
                .collect())
        }
    }
}

/// Never retry accepted input. A partial batch only permits best-effort releases.
pub fn send_batches(
    events: &[Vec<INPUT>],
    may_elevate: bool,
    check: impl Fn() -> Result<()>,
    mut send: impl FnMut(&[INPUT]) -> u32,
) -> Result<()> {
    let mut accepted = 0;
    for batch in events {
        check()?;
        let sent = send(batch) as usize;
        if sent != batch.len() {
            if sent > 0 {
                let releases: Vec<_> = batch
                    .iter()
                    .filter(|event| unsafe {
                        (event.r#type == INPUT_KEYBOARD
                            && event.Anonymous.ki.dwFlags & KEYEVENTF_KEYUP != 0)
                            || (event.r#type == INPUT_MOUSE
                                && event.Anonymous.mi.dwFlags & MOUSEEVENTF_LEFTUP != 0)
                    })
                    .copied()
                    .collect();
                if !releases.is_empty() {
                    send(&releases);
                }
            }
            return Err(if accepted == 0 && sent == 0 && may_elevate {
                Failure::new("elevation-required", "Windows rejected input before dispatch; administrator authorization is required.")
            } else {
                Failure::new("input-rejected", format!("Windows accepted {sent}/{} events in the current batch ({accepted} earlier events accepted). Input may be incomplete; inspect the screen before retrying.", batch.len()))
            });
        }
        accepted += sent;
    }
    Ok(())
}

/// A denied token query is unknown permission, never permission to inject.
/// Recheck after UAC; if an elevated helper still cannot inspect the target, stop.
pub fn check_target_integrity(own_integrity: u32, target: Result<u32>) -> Result<()> {
    let reason = match target {
        Ok(level) if level <= own_integrity => return Ok(()),
        Ok(_) => "The input target requires a higher integrity level.".to_owned(),
        Err(error) => format!("Cannot verify input target permissions. {}", error.message),
    };
    Err(Failure::new(
        if own_integrity < 0x3000 {
            "elevation-required"
        } else {
            "input-rejected"
        },
        format!("{reason} No input was dispatched."),
    ))
}

/// Reject partially visible targets too: their focused control may be off-screen.
pub fn check_keyboard_bounds(frame: &Frame, bounds: &RECT) -> Result<()> {
    if bounds.left < 0
        || bounds.top < 0
        || bounds.right <= bounds.left
        || bounds.bottom <= bounds.top
        || i64::from(bounds.right) > i64::from(frame.screen_width)
        || i64::from(bounds.bottom) > i64::from(frame.screen_height)
    {
        return Err(Failure::new("input-rejected",
            "Keyboard input requires a foreground window fully inside the primary display. Focus a visible primary-display window before retrying."));
    }
    Ok(())
}

fn check_keyboard_target(window: HWND, frame: &Frame) -> Result<()> {
    if window == 0 || unsafe { GetForegroundWindow() } != window {
        return Err(Failure::new("input-rejected", "Keyboard focus changed; no further input is permitted. Inspect the primary display before retrying."));
    }
    let mut bounds = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetClientRect(window, &mut bounds) } == 0 {
        return Err(Failure::system("Reading keyboard target bounds failed"));
    }
    // Client bounds exclude the invisible resize border of maximized windows.
    // The helper is per-monitor DPI aware, so these are physical screen pixels.
    let mut start = POINT {
        x: bounds.left,
        y: bounds.top,
    };
    let mut end = POINT {
        x: bounds.right,
        y: bounds.bottom,
    };
    if unsafe { ClientToScreen(window, &mut start) } == 0
        || unsafe { ClientToScreen(window, &mut end) } == 0
    {
        return Err(Failure::system("Locating keyboard target failed"));
    }
    check_keyboard_bounds(
        frame,
        &RECT {
            left: start.x,
            top: start.y,
            right: end.x,
            bottom: end.y,
        },
    )
}

pub fn dispatch(action: &Action, frame: &Frame, check: impl Fn() -> Result<()>) -> Result<()> {
    check()?;
    if unsafe { GetSystemMetrics(SM_CXSCREEN) } != frame.screen_width as i32
        || unsafe { GetSystemMetrics(SM_CYSCREEN) } != frame.screen_height as i32
    {
        return Err(Failure::new(
            "stale-observation",
            "Primary display geometry changed. Use a fresh screenshot.",
        ));
    }
    let events = batches(action, frame)?;
    let own_integrity = integrity(None)?;
    let foreground = unsafe { GetForegroundWindow() };
    let mut windows = vec![foreground];
    if let Action::Click { x, y } | Action::Scroll { x, y, .. } = action {
        let (x, y) = physical_point(frame, *x, *y)?;
        windows.push(unsafe { WindowFromPoint(POINT { x, y }) });
    }
    for window in windows {
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(window, &mut pid);
        }
        if pid != 0 {
            check_target_integrity(own_integrity, integrity(Some(pid)))?;
        }
    }
    let check_input = || {
        check()?;
        if matches!(action, Action::Key { .. } | Action::Type { .. }) {
            // Recheck every complete character, not just the start of a long type.
            check_keyboard_target(foreground, frame)?;
        }
        Ok(())
    };
    send_batches(
        &events,
        own_integrity < 0x3000,
        check_input,
        |batch| unsafe {
            SendInput(
                batch.len() as u32,
                batch.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        },
    )
}
