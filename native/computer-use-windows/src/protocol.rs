use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_MESSAGE_BYTES: usize = 32_768;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    #[serde(flatten)]
    pub command: Command,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Command {
    Probe {},
    Authorize {},
    EndSession {},
    Start {
        #[serde(default)]
        elevate: bool,
    },
    Action {
        action: Action,
        frame: Frame,
    },
    Shutdown {},
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Action {
    Click {
        x: u32,
        y: u32,
    },
    Scroll {
        x: u32,
        y: u32,
        direction: Direction,
        amount: u32,
    },
    Key {
        key: String,
        #[serde(default)]
        modifiers: Vec<Modifier>,
    },
    Type {
        text: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Up,
    Down,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
pub enum Modifier {
    Meta,
    Control,
    Alt,
    Shift,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub screen_width: u32,
    pub screen_height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, Failure>;

impl Failure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn system(operation: &str) -> Self {
        Self::new(
            "native-failed",
            format!("{operation}: {}", std::io::Error::last_os_error()),
        )
    }
    pub fn cancelled() -> Self {
        Self::new(
            "cancelled",
            "Desktop control cancelled; no further input is permitted.",
        )
    }
}

impl Reply {
    pub fn from_result(id: u64, result: Result<Value>) -> Self {
        match result {
            Ok(value) => Self {
                id,
                result: Some(value),
                error: None,
                error_code: None,
            },
            Err(error) => Self {
                id,
                result: None,
                error: Some(error.message),
                error_code: Some(error.code.into()),
            },
        }
    }
}
