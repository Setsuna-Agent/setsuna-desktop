use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::env;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::ExitCode;
use std::time::{Duration, Instant};

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("network probe failed: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(arguments: Vec<String>) -> io::Result<()> {
    match arguments.as_slice() {
        [mode, host, port, timeout_ms] if mode == "tcp" => {
            connect_with_timeout(host, parse_u16(port, "port")?, parse_timeout(timeout_ms)?)
                .map(|_| ())
        }
        [mode, target_url, timeout_ms] if mode == "proxy" => {
            probe_http_proxy(target_url, parse_timeout(timeout_ms)?)
        }
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "usage: windows-network-probe tcp <host> <port> <timeout-ms> | proxy <http-url> <timeout-ms>",
        )),
    }
}

fn parse_u16(value: &str, label: &str) -> io::Result<u16> {
    value.parse().map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid {label} {value:?}: {error}"),
        )
    })
}

fn parse_timeout(value: &str) -> io::Result<Duration> {
    let milliseconds = value.parse::<u64>().map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid timeout {value:?}: {error}"),
        )
    })?;
    if milliseconds == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "timeout must be greater than zero",
        ));
    }
    Ok(Duration::from_millis(milliseconds))
}

fn probe_http_proxy(target_url: &str, timeout: Duration) -> io::Result<()> {
    let proxy_url = env::var("HTTP_PROXY").map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "HTTP_PROXY is missing from the sandbox environment",
        )
    })?;
    probe_http_proxy_url(&proxy_url, target_url, timeout)
}

fn probe_http_proxy_url(proxy_url: &str, target_url: &str, timeout: Duration) -> io::Result<()> {
    let proxy = parse_http_proxy(proxy_url)?;
    let (target_host, _) = parse_http_target(target_url)?;
    let mut stream = connect_with_timeout(&proxy.host, proxy.port, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let authorization = proxy.credentials.map_or_else(String::new, |credentials| {
        format!(
            "Proxy-Authorization: Basic {}\r\n",
            BASE64.encode(credentials)
        )
    });
    let request = format!(
        "GET {target_url} HTTP/1.1\r\nHost: {target_host}\r\n{authorization}Connection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;

    let headers = read_http_headers(&mut stream)?;
    let status_line = headers.lines().next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "proxy response has no status line",
        )
    })?;
    let status = status_line
        .split_ascii_whitespace()
        .nth(1)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid proxy status line"))?
        .parse::<u16>()
        .map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("invalid proxy status code: {error}"),
            )
        })?;
    if !(200..300).contains(&status) {
        return Err(io::Error::other(format!(
            "proxy returned HTTP status {status}"
        )));
    }
    Ok(())
}

struct HttpProxy {
    host: String,
    port: u16,
    credentials: Option<Vec<u8>>,
}

fn parse_http_proxy(url: &str) -> io::Result<HttpProxy> {
    let authority = url
        .strip_prefix("http://")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "proxy must use http://"))?
        .split('/')
        .next()
        .unwrap_or_default();
    let (userinfo, endpoint) = match authority.rsplit_once('@') {
        Some((userinfo, endpoint)) => (Some(userinfo), endpoint),
        None => (None, authority),
    };
    let (host, port) = parse_endpoint(endpoint, 80)?;
    let credentials = userinfo.map(percent_decode).transpose()?;
    Ok(HttpProxy {
        host,
        port,
        credentials,
    })
}

fn parse_http_target(url: &str) -> io::Result<(String, u16)> {
    let authority = url
        .strip_prefix("http://")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target must use http://"))?
        .split('/')
        .next()
        .unwrap_or_default();
    parse_endpoint(authority, 80)
}

fn parse_endpoint(authority: &str, default_port: u16) -> io::Result<(String, u16)> {
    if let Some(suffix) = authority.strip_prefix('[') {
        let (host, suffix) = suffix.split_once(']').ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "invalid bracketed endpoint")
        })?;
        let port = match suffix.strip_prefix(':') {
            Some(value) => parse_u16(value, "port")?,
            None if suffix.is_empty() => default_port,
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid bracketed endpoint suffix",
                ))
            }
        };
        return Ok((host.to_string(), port));
    }
    if authority.matches(':').count() == 1 {
        let (host, port) = authority.rsplit_once(':').expect("one colon");
        if host.is_empty() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "host is empty"));
        }
        return Ok((host.to_string(), parse_u16(port, "port")?));
    }
    if authority.is_empty() || authority.contains(':') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid or unbracketed endpoint",
        ));
    }
    Ok((authority.to_string(), default_port))
}

fn percent_decode(value: &str) -> io::Result<Vec<u8>> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "proxy credentials contain a truncated escape",
            ));
        }
        let high = hex_digit(bytes[index + 1])?;
        let low = hex_digit(bytes[index + 2])?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    Ok(decoded)
}

fn hex_digit(value: u8) -> io::Result<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "proxy credentials contain an invalid escape",
        )),
    }
}

fn read_http_headers(stream: &mut TcpStream) -> io::Result<String> {
    const MAX_HEADERS: usize = 16 * 1024;
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "proxy closed the connection before completing its response headers",
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > MAX_HEADERS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "proxy response headers are too large",
            ));
        }
    }
    let end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 4)
        .expect("loop exits only after complete headers");
    bytes.truncate(end);
    String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn connect_with_timeout(host: &str, port: u16, timeout: Duration) -> io::Result<TcpStream> {
    let started = Instant::now();
    let addresses = (host, port).to_socket_addrs()?.collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::AddrNotAvailable,
            "endpoint resolved to no addresses",
        ));
    }
    let mut last_error = None;
    for address in addresses {
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        match TcpStream::connect_timeout(&address, remaining) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "connect timed out")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parses_and_decodes_authenticated_proxy_urls() {
        let parsed = parse_http_proxy("http://user:p%40ss@127.0.0.1:61080").expect("proxy");
        assert_eq!(parsed.host, "127.0.0.1");
        assert_eq!(parsed.port, 61_080);
        assert_eq!(parsed.credentials.as_deref(), Some(b"user:p@ss".as_slice()));
    }

    #[test]
    fn rejects_invalid_percent_escapes() {
        assert!(parse_http_proxy("http://user:%zz@127.0.0.1:61080").is_err());
    }

    #[test]
    fn sends_basic_auth_and_requires_a_success_status() {
        let (url, request) = serve_once("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n");
        probe_http_proxy_url(&url, "http://example.com/", Duration::from_secs(2))
            .expect("successful proxy response");
        let request = request.join().expect("proxy request");
        assert!(request.contains("Proxy-Authorization: Basic c2FuZGJveDpzZWNyZXQ=\r\n"));

        let (url, request) =
            serve_once("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
        let error = probe_http_proxy_url(&url, "http://example.com/", Duration::from_secs(2))
            .expect_err("407 must fail");
        request.join().expect("proxy request");
        assert!(error.to_string().contains("407"));
    }

    fn serve_once(response: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind proxy");
        let port = listener.local_addr().expect("proxy address").port();
        let request = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept proxy request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("read timeout");
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).expect("read proxy request");
            stream
                .write_all(response.as_bytes())
                .expect("write proxy response");
            String::from_utf8(buffer[..read].to_vec()).expect("ASCII request")
        });
        (format!("http://sandbox:secret@127.0.0.1:{port}"), request)
    }
}
