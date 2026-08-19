let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const toolInput = payload.tool_input || payload.toolInput || {};
  const command = String(toolInput.command || toolInput.cmd || toolInput.input || '');
  const posixPatterns = [
    /\brm\s+-rf\s+(?:\/|~|\.\.?\s*$)/i,
    /\bsudo\s+rm\b/i,
    /\bmkfs(?:\.|\s)/i,
    /\bdiskutil\s+erase/i,
    /\bdd\s+if=.*\bof=\/dev\//i,
    /\bgit\s+(?:reset\s+--hard|clean\s+-fdx?)\b/i,
    /:\s*\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  ];
  const windowsPatterns = [
    /\b(?:Remove-Item|ri|rm|del|erase|rd|rmdir)\b(?=[^;&|\r\n]*-Force(?::(?:\$?true|1))?\b)/i,
    /\bformat\s+[a-z]:/i,
    /\bClear-Disk\b/i,
    /\b(?:del|erase)\b(?=[^;&|\r\n]*\/f\b)/i,
    /\b(?:rd|rmdir)\b(?=[^;&|\r\n]*\/s\b)(?=[^;&|\r\n]*\/q\b)/i,
    /\bgit\s+(?:reset\s+--hard|clean\s+-fdx?)\b/i,
  ];
  // 命令可以显式进入 Git Bash、WSL、PowerShell 或其他 shell，不能只按宿主系统检查一种语法。
  const patterns = [...posixPatterns, ...windowsPatterns];
  if (patterns.some((pattern) => pattern.test(command))) {
    process.stderr.write('危险 Shell 命令已被防护插件阻止，请调整命令或停用该 Hook。');
    process.exitCode = 2;
  }
});
