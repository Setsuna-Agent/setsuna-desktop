export function parseNumberExpression(input: string): number | undefined {
  const text = input.trim();
  // Bound the work and recursion depth for pasted input.
  if (!text || text.length > 512) return;
  const tokens = text.replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/')
    .match(/\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|./giu)?.filter((token) => token.trim()) ?? [];
  let position = 0;
  let calculated = false;

  function readSum(): number {
    let value = readProduct();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++];
      const right = readProduct();
      value = operator === '+' ? value + right : value - right;
      if (!Number.isFinite(value)) return NaN;
      calculated = true;
    }
    return value;
  }

  function readProduct(): number {
    let value = readOperand();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position++];
      const right = readOperand();
      value = operator === '*' ? value * right : value / right;
      if (!Number.isFinite(value)) return NaN;
      calculated = true;
    }
    return value;
  }

  function readOperand(): number {
    const token = tokens[position++];
    if (token === '-') return -readOperand();
    if (token === '+') return readOperand();
    if (token === '(') {
      const value = readSum();
      return tokens[position++] === ')' ? value : NaN;
    }
    const value = Number(token);
    return Number.isFinite(value) ? value : NaN;
  }

  const value = readSum();
  if (position !== tokens.length || !Number.isFinite(value)) return;
  // Remove floating-point noise in calculated decimals while preserving literals and exact integers.
  if (!calculated || Number.isSafeInteger(value)) return value;
  const rounded = Number(value.toPrecision(15));
  return Number.isFinite(rounded) ? rounded : value;
}
