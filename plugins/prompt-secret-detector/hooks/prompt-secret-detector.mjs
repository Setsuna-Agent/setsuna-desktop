let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const prompt = String(payload.prompt || '');
  const secretLike = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})/;
  if (!secretLike.test(prompt)) return;
  process.stdout.write(JSON.stringify({
    continue: false,
    stopReason: '这条消息看起来包含密钥或私钥片段。请先脱敏，再重新发送。',
  }));
});
