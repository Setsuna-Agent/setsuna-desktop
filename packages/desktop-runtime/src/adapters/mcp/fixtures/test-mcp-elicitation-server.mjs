import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pendingForms = new Map();
let urlToolCalls = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'setsuna-elicitation-test', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          { name: 'collect_profile', inputSchema: { type: 'object' } },
          { name: 'url_auth', inputSchema: { type: 'object' } },
        ],
      },
    });
    return;
  }
  if (method === 'tools/call' && params.name === 'collect_profile') {
    const requestId = `elicit_form_${id}`;
    pendingForms.set(requestId, id);
    send({
      jsonrpc: '2.0',
      id: requestId,
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: 'Provide a display name.',
        requestedSchema: {
          type: 'object',
          properties: { displayName: { type: 'string', title: 'Display name' } },
          required: ['displayName'],
        },
      },
    });
    return;
  }
  if (method === 'tools/call' && params.name === 'url_auth') {
    urlToolCalls += 1;
    if (urlToolCalls === 1) {
      const elicitationId = 'url_auth_1';
      send({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32042,
          message: 'Authorization required.',
          data: {
            elicitations: [{
              mode: 'url',
              message: 'Authorize the test account.',
              elicitationId,
              url: 'https://example.com/authorize?one_time_token=secret',
            }],
          },
        },
      });
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'notifications/elicitation/complete',
          params: { elicitationId },
        });
      }, 25);
      return;
    }
    send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `authorized after ${urlToolCalls} calls` }] },
    });
    return;
  }
  if (id && pendingForms.has(id) && !method) {
    const toolCallId = pendingForms.get(id);
    pendingForms.delete(id);
    const displayName = message.result?.content?.displayName ?? 'missing';
    send({
      jsonrpc: '2.0',
      id: toolCallId,
      result: { content: [{ type: 'text', text: `hello ${displayName}` }] },
    });
    return;
  }
  if (method === 'notifications/cancelled') {
    pendingForms.delete(params.requestId);
  }
});

process.stdin.on('end', () => process.exit(0));
