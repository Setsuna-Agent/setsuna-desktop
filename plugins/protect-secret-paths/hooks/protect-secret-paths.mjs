let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const text = JSON.stringify(payload.tool_input || payload.toolInput || {});
  const sensitivePath = /(?:^|[\\/"'])(?:\.env(?:\.[^\\/"']+)?|id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials(?:\.json)?|service-account(?:\.json)?)(?=[\\/"']|$)/i;
  if (sensitivePath.test(text)) {
    process.stderr.write('敏感文件路径已被防护插件阻止，如确需处理请临时停用该 Hook。');
    process.exitCode = 2;
  }
});
