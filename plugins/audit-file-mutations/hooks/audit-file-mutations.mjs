let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const toolName = payload.tool_name || payload.toolName || 'file tool';
  const reviewReminder = `文件改动工具 ${toolName} 已完成，请点击“审查/Review”查看 diff，并在提交前运行必要验证。`;
  process.stdout.write(JSON.stringify({
    systemMessage: reviewReminder,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: '在完成本轮前，必须明确提醒用户点击“审查/Review”查看文件 diff，并说明已运行的必要验证；不要把该提醒当作用户已经完成了人工审查。',
    },
  }));
});
