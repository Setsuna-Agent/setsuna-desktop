let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  process.stdout.write(JSON.stringify({
    systemMessage: `即将执行 ${String(payload.trigger || 'unknown')} context compaction。`,
  }));
});
