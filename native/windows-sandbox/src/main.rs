#[cfg_attr(not(windows), allow(dead_code))]
mod capability;
mod platform;
#[cfg_attr(not(windows), allow(dead_code))]
mod protocol;
#[cfg_attr(not(windows), allow(dead_code))]
mod state;

use crate::protocol::{CommandOutput, SandboxError, SandboxErrorCode};
use std::env;
use std::path::PathBuf;

fn main() {
    let exit_code = match run() {
        Ok(output) => {
            if output.emit {
                print_json(&output);
            }
            output.exit_code
        }
        Err(error) => {
            print_json(&CommandOutput::failure(&error));
            error.exit_code()
        }
    };
    std::process::exit(exit_code);
}

fn run() -> Result<CommandOutput, SandboxError> {
    let mut args = env::args_os();
    let _program = args.next();
    let command = args
        .next()
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| "status".to_string());
    let remaining = args.collect::<Vec<_>>();

    match command.as_str() {
        "version" | "--version" | "-V" => Ok(CommandOutput::version()),
        "status" | "doctor" => platform::status(),
        "install" => platform::install(false),
        "repair" => platform::install(true),
        "uninstall" => platform::uninstall(),
        "run" => {
            let request_path = option_path(&remaining, "--request")?;
            platform::run(&request_path)
        }
        "internal-child" => {
            let request_path = option_path(&remaining, "--request")?;
            let capability_sid = option_string(&remaining, "--capability-sid")?;
            platform::internal_child(&request_path, &capability_sid)
        }
        "install-elevated" => {
            let owner_sid = option_string(&remaining, "--owner-sid")?;
            platform::install_elevated(&owner_sid)
        }
        "uninstall-elevated" => platform::uninstall_elevated(),
        other => Err(SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            format!("unknown command: {other}"),
        )),
    }
}

fn option_path(args: &[std::ffi::OsString], name: &str) -> Result<PathBuf, SandboxError> {
    let value = option_os(args, name)?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            format!("{name} must be an absolute path"),
        ));
    }
    Ok(path)
}

fn option_string(args: &[std::ffi::OsString], name: &str) -> Result<String, SandboxError> {
    option_os(args, name)?.into_string().map_err(|_| {
        SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            format!("{name} must be valid Unicode"),
        )
    })
}

fn option_os(args: &[std::ffi::OsString], name: &str) -> Result<std::ffi::OsString, SandboxError> {
    let index = args.iter().position(|value| value == name).ok_or_else(|| {
        SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            format!("missing required option {name}"),
        )
    })?;
    args.get(index + 1).cloned().ok_or_else(|| {
        SandboxError::new(
            SandboxErrorCode::InvalidArguments,
            format!("missing value for {name}"),
        )
    })
}

fn print_json(output: &CommandOutput) {
    match serde_json::to_string(output) {
        Ok(json) => println!("{json}"),
        Err(error) => println!(
            "{{\"ok\":false,\"error\":{{\"code\":\"internal\",\"message\":{:?}}}}}",
            error.to_string()
        ),
    }
}
