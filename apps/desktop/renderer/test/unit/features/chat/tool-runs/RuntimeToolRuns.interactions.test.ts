import { describe, expect, it } from 'vitest';
import { renderedTextFromHtml, renderedHtml } from './RuntimeToolRuns.support.js';

describe('RuntimeToolRuns shell and interaction summaries', () => {

  it('renders MCP form and URL elicitations as structured, query-redacted interactions', () => {
    const formHtml = renderedHtml([{
      id: 'call_form',
      name: 'mcp__profile__collect',
      status: 'pending_approval',
      approvalId: 'approval_form',
      approvalStatus: 'pending',
      elicitation: {
        mode: 'form',
        serverKey: 'profile',
        message: 'Provide your profile.',
        requestedSchema: {
          type: 'object',
          properties: {
            displayName: { type: 'string', title: '显示名称' },
            newsletter: { type: 'boolean', title: '订阅更新' },
          },
          required: ['displayName'],
        },
      },
    }]);
    const urlHtml = renderedHtml([{
      id: 'call_url',
      name: 'mcp__auth__login',
      status: 'pending_approval',
      approvalId: 'approval_url',
      approvalStatus: 'pending',
      elicitation: {
        mode: 'url',
        serverKey: 'auth',
        message: 'Authorize access.',
        displayUrl: 'https://example.com/authorize',
        elicitationId: 'elicit_1',
      },
    }]);

    expect(renderedTextFromHtml(formHtml)).toContain('MCP Server 请求输入');
    expect(renderedTextFromHtml(formHtml)).toContain('显示名称必填');
    expect(formHtml).toContain('name="displayName"');
    expect(renderedTextFromHtml(urlHtml)).toContain('允许并打开');
    expect(urlHtml).toContain('https://example.com/authorize');
    expect(urlHtml).not.toContain('one_time_token');
  });

});
