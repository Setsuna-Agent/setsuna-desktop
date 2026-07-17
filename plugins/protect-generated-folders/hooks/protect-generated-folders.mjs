let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const text = JSON.stringify(payload.tool_input || payload.toolInput || {});
  const generatedPath = /(?:^|[\\/])(?:node_modules|dist|build|coverage|target|\.next|\.turbo)(?:[\\/]|$)/i;
  if (generatedPath.test(text)) {
    process.stderr.write('生成目录防护插件阻止了对依赖目录或构建产物的直接写入。');
    process.exitCode = 2;
  }
});
