let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  if (payload.stop_hook_active) return;
  const message = String(payload.last_assistant_message || '');
  if (!/\b(?:TODO|FIXME|XXX)\b/.test(message)) return;
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '最后回复仍包含 TODO/FIXME 标记。请继续完成或明确解释为什么保留。',
  }));
});
