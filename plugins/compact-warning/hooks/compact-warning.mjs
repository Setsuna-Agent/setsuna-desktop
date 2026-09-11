let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  process.stdout.write(JSON.stringify({
    systemMessage: payload.interface_language === 'en-US' ? `Context compaction is about to run (trigger: ${String(payload.trigger || 'unknown')}).` : `即将执行上下文压缩（触发方式：${String(payload.trigger || 'unknown')}）。`,
  }));
});
