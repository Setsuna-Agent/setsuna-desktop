import { expect, it } from 'vitest';
import { parseNumberExpression } from '../../src/fields/number-expression.js';

it.each([
  ['12 + 4 * 3', 24],
  ['(12 + 4) × -3', -48],
  ['8 ÷ 2 / 2', 2],
  ['-1.25e-2 + .5', 0.4875],
  ['0.1 + 0.2', 0.3],
  ['9007199254740991', 9007199254740991],
])('calculates %s as %s', (expression, expected) => {
  expect(parseNumberExpression(expression)).toBe(expected);
});

it.each(['12 -', '2(3)', '(5 + 2', '3px', '1 / (1 / 0)', '1e308 * 10'])('rejects %s', (expression) => {
  expect(parseNumberExpression(expression)).toBeUndefined();
});
