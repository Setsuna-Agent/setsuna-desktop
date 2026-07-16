import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Map();
let statefulCalls = 0;

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
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'setsuna-stdio-test', version: '1.0.0' },
        instructions: 'Use this fixture only as external test context.',
      },
    });
    return;
  }
  if (method === 'tools/list') {
    const secondPage = params.cursor === 'tools_page_2';
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: secondPage
          ? [{ name: 'slow', inputSchema: { type: 'object' } }]
          : [{ name: 'stateful', inputSchema: { type: 'object' } }],
        ...(secondPage ? {} : { nextCursor: 'tools_page_2' }),
      },
    });
    return;
  }
  if (method === 'resources/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: { resources: [{ uri: 'memo://stdio', name: 'stdio memo', mimeType: 'text/plain' }] },
    });
    return;
  }
  if (method === 'resources/templates/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: { resourceTemplates: [{ uriTemplate: 'memo://{id}', name: 'memo' }] },
    });
    return;
  }
  if (method === 'resources/read') {
    send({
      jsonrpc: '2.0',
      id,
      result: { contents: [{ uri: params.uri, mimeType: 'text/plain', text: `read ${params.uri}` }] },
    });
    return;
  }
  if (method === 'tools/call' && params.name === 'stateful') {
    statefulCalls += 1;
    send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `stateful call ${statefulCalls}` }] },
    });
    return;
  }
  if (method === 'tools/call' && params.name === 'slow') {
    const timer = setTimeout(() => {
      pending.delete(id);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'too late' }] } });
    }, 5_000);
    pending.set(id, timer);
    return;
  }
  if (method === 'notifications/cancelled') {
    const timer = pending.get(params.requestId);
    if (timer) {
      clearTimeout(timer);
      pending.delete(params.requestId);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
