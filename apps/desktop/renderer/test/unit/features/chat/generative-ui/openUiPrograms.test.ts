import { readFileSync } from 'node:fs';
import { createParser } from '@openuidev/react-lang';
import { describe, expect, it } from 'vitest';
import { presentationLibrary } from '../../../../../src/features/chat/generative-ui/openUiLibrary.js';

const parser = createParser(presentationLibrary.toJSONSchema(), presentationLibrary.root);
const examples = ['examples.md', 'examples.en-US.md'].map(name =>
  readFileSync(new URL(`../../../../../../../../skills/display-in-chat/references/${name}`, import.meta.url), 'utf8')).join('\n');

describe('Agent presentation programs', () => {
  it.each([...examples.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match, index) => [index + 1, match[1]] as const))(
    'accepts documented program %s with the installed catalog', (_index, program) => {
      const result = parser.parse(program);
      expect(result.root?.typeName).toBe('Stack');
      expect(result.meta.incomplete).toBe(false);
      expect(result.meta.unresolved).toEqual([]);
      expect(result.meta.errors).toEqual([]);
      expect(result.queryStatements).toEqual([]);
      expect(result.mutationStatements).toEqual([]);
    },
  );

  it.each(['Form("submit", [Input("name")])', 'EditableTable("edit", [], [])'])(
    'rejects submission components even inside a flexible layout: %s', (component) => {
      const result = parser.parse(`root = Stack([${component}])`);
      expect(result.meta.errors.some((error) => error.code === 'unknown-component')).toBe(true);
    },
  );
});
