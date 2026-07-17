let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const toolName = payload.tool_name || payload.toolName || 'file tool';
  process.stdout.write(JSON.stringify({
    systemMessage: `文件改动工具 ${toolName} 已完成，提交前请 review diff 并运行必要验证。`,
  }));
});
