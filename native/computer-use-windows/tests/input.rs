use setsuna_computer_windows::{
    input::{batches, check_keyboard_bounds, check_target_integrity, physical_point, send_batches},
    protocol::{Action, Failure, Frame, Modifier, Request},
};
use std::cell::Cell;
use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;

fn frame() -> Frame {
    Frame {
        width: 800,
        height: 400,
        screen_width: 2000,
        screen_height: 1000,
    }
}

#[test]
fn keyboard_input_rejects_offscreen_and_spanning_windows_before_sending() {
    for bounds in [
        RECT {
            left: 0,
            top: 0,
            right: 2000,
            bottom: 1000,
        },
        RECT {
            left: 500,
            top: 300,
            right: 1800,
            bottom: 900,
        },
    ] {
        check_keyboard_bounds(&frame(), &bounds).unwrap();
    }
    for bounds in [
        RECT {
            left: 2000,
            top: 0,
            right: 4000,
            bottom: 1000,
        },
        RECT {
            left: -2000,
            top: 0,
            right: 0,
            bottom: 1000,
        },
        RECT {
            left: 0,
            top: -1000,
            right: 2000,
            bottom: 0,
        },
        RECT {
            left: 0,
            top: 1000,
            right: 2000,
            bottom: 2000,
        },
        RECT {
            left: 1900,
            top: 0,
            right: 2100,
            bottom: 1000,
        },
        RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
    ] {
        for action in [
            Action::Key {
                key: "Enter".into(),
                modifiers: vec![],
            },
            Action::Type {
                text: "hello".into(),
            },
        ] {
            let events = batches(&action, &frame()).unwrap();
            let result = send_batches(
                &events,
                false,
                || check_keyboard_bounds(&frame(), &bounds),
                |_| panic!("offscreen input dispatched"),
            );
            assert_eq!(result.unwrap_err().code, "input-rejected");
        }
    }
}

#[test]
fn typing_stops_between_characters_when_the_target_moves_offscreen() {
    let events = batches(&Action::Type { text: "abc".into() }, &frame()).unwrap();
    let sent = Cell::new(0);
    let error = send_batches(
        &events,
        false,
        || {
            let left = if sent.get() == 0 { 0 } else { 2000 };
            check_keyboard_bounds(
                &frame(),
                &RECT {
                    left,
                    top: 0,
                    right: left + 1000,
                    bottom: 500,
                },
            )
        },
        |batch| {
            sent.set(sent.get() + 1);
            batch.len() as u32
        },
    )
    .unwrap_err();
    assert_eq!(sent.get(), 1);
    assert_eq!(error.code, "input-rejected");
}

#[test]
fn resized_screenshots_map_once_and_normalized_coordinates_land_inside_the_pixel() {
    assert_eq!(physical_point(&frame(), 400, 200).unwrap(), (1000, 500));
    assert!(physical_point(&frame(), 800, 0).is_err());
    for (x, y) in [(0, 0), (400, 200), (799, 399)] {
        let events = batches(&Action::Click { x, y }, &frame()).unwrap();
        let position = unsafe { events[0][0].Anonymous.mi };
        let (physical_x, physical_y) = physical_point(&frame(), x, y).unwrap();
        assert_eq!(position.dx * 2000 / 65536, physical_x);
        assert_eq!(position.dy * 1000 / 65536, physical_y);
        assert_eq!(events[0].len(), 3);
    }
}

#[test]
fn screenshot_pixels_map_to_sendinput_at_different_capture_scales() {
    // The input boundary receives image pixels, irrespective of Windows DPI.
    for (width, height, screen_width, screen_height, x, y, expected) in [
        (1920, 1080, 2560, 1440, 680, 289, (906, 385)),
        (1920, 1080, 2560, 1440, 1200, 960, (1600, 1280)),
        (1280, 720, 2560, 1440, 1279, 719, (2558, 1438)),
        (1080, 1920, 1440, 2560, 540, 960, (720, 1280)),
        (800, 600, 800, 600, 300, 200, (300, 200)),
    ] {
        let frame = Frame {
            width,
            height,
            screen_width,
            screen_height,
        };
        assert_eq!(physical_point(&frame, x, y).unwrap(), expected);
        for action in [
            Action::Click { x, y },
            Action::Scroll {
                x,
                y,
                direction: setsuna_computer_windows::protocol::Direction::Down,
                amount: 2,
            },
        ] {
            let events = batches(&action, &frame).unwrap();
            let position = unsafe { events[0][0].Anonymous.mi };
            assert_eq!(position.dx * screen_width as i32 / 65536, expected.0);
            assert_eq!(position.dy * screen_height as i32 / 65536, expected.1);
        }
    }
}

#[test]
fn failed_and_partial_input_never_report_success_or_replay_accepted_events() {
    let events = batches(&Action::Type { text: "ab".into() }, &frame()).unwrap();
    assert_eq!(
        send_batches(&events, true, || Ok(()), |_| 0)
            .unwrap_err()
            .code,
        "elevation-required"
    );
    assert_eq!(
        send_batches(&events, false, || Ok(()), |_| 0)
            .unwrap_err()
            .code,
        "input-rejected"
    );
    let mut calls = 0;
    let error = send_batches(
        &events,
        true,
        || Ok(()),
        |batch| {
            calls += 1;
            if calls == 1 {
                batch.len() as u32
            } else {
                0
            }
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "input-rejected");
    assert_eq!(calls, 2);
    let mut lengths = Vec::new();
    let error = send_batches(
        &events,
        true,
        || Ok(()),
        |batch| {
            lengths.push(batch.len());
            1
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "input-rejected");
    assert_eq!(lengths, [2, 1]);
}

#[test]
fn unreadable_target_permissions_require_uac_before_any_input_and_fail_closed_afterwards() {
    for target_level in [0x1000, 0x2000] {
        check_target_integrity(0x2000, Ok(target_level)).unwrap();
    }
    for target in [
        Ok(0x3000),
        Err(Failure::new(
            "native-failed",
            "OpenProcessToken: access denied (5)",
        )),
    ] {
        let mut sent = false;
        let result = check_target_integrity(0x2000, target).map(|()| {
            sent = true;
        });
        assert_eq!(result.unwrap_err().code, "elevation-required");
        assert!(!sent);
    }
    check_target_integrity(0x3000, Ok(0x3000)).unwrap();
    for target in [
        Ok(0x4000),
        Err(Failure::new("native-failed", "Target still inaccessible")),
    ] {
        assert_eq!(
            check_target_integrity(0x3000, target).unwrap_err().code,
            "input-rejected"
        );
    }
}

#[test]
fn cancellation_occurs_between_complete_unicode_characters() {
    let events = batches(
        &Action::Type {
            text: "中🙂后".into(),
        },
        &frame(),
    )
    .unwrap();
    assert_eq!(events.iter().map(Vec::len).collect::<Vec<_>>(), [2, 4, 2]);
    let calls = Cell::new(0);
    let error = send_batches(
        &events,
        true,
        || {
            if calls.get() == 2 {
                Err(Failure::cancelled())
            } else {
                Ok(())
            }
        },
        |batch| {
            calls.set(calls.get() + 1);
            batch.len() as u32
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "cancelled");
    assert_eq!(calls.get(), 2);
}

#[test]
fn chords_release_in_reverse_order_and_reject_unbounded_or_script_input() {
    let events = batches(
        &Action::Key {
            key: "ArrowLeft".into(),
            modifiers: vec![Modifier::Control, Modifier::Shift],
        },
        &frame(),
    )
    .unwrap();
    let keys: Vec<_> = events[0]
        .iter()
        .map(|e| unsafe { (e.Anonymous.ki.wVk, e.Anonymous.ki.dwFlags) })
        .collect();
    assert_eq!(
        keys,
        [
            (VK_CONTROL, 0),
            (VK_SHIFT, 0),
            (VK_LEFT, KEYEVENTF_EXTENDEDKEY),
            (VK_LEFT, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP),
            (VK_SHIFT, KEYEVENTF_KEYUP),
            (VK_CONTROL, KEYEVENTF_KEYUP)
        ]
    );
    for value in [
        r#"{"id":1,"kind":"shell","command":"whoami"}"#,
        r#"{"id":1,"kind":"start","script":"payload"}"#,
    ] {
        assert!(serde_json::from_str::<Request>(value).is_err());
    }
    assert!(serde_json::from_str::<Request>(r#"{"id":1,"kind":"probe"}"#).is_ok());
}
