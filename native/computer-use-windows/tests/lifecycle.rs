use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
fn real_helper_probes_without_input_then_acknowledges_shutdown() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_setsuna-computer-win"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    for (id, kind) in [
        (1, "probe"),
        (2, "start"),
        (3, "end-session"),
        (4, "start"),
        (5, "shutdown"),
    ] {
        writeln!(input, "{}", json!({"id": id, "kind": kind})).unwrap();
        input.flush().unwrap();
        let mut line = String::new();
        assert!(output.read_line(&mut line).unwrap() > 0);
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(reply["id"], id);
        assert!(reply.get("error").is_none(), "{reply}");
        match kind {
            "probe" => assert_eq!(reply["result"]["protocolVersion"], 1),
            "start" => assert_eq!(reply["result"]["ready"], true),
            _ => assert_eq!(reply["result"]["stopped"], true),
        }
    }
    assert!(child.wait().unwrap().success());
}

#[test]
fn closing_the_private_input_channel_exits_the_helper() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_setsuna-computer-win"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());
}
