const STATE_KEY = 'todos';
const MAX_TODOS = 200;

export default function activate(api) {
  api.registerTool({
    name: 'todo',
    description: 'Manage a conversation todo list. Actions: list, add (text), toggle (id), clear.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'toggle', 'clear'] },
        text: { type: 'string', description: 'Todo text; required when action is add.' },
        id: { type: 'integer', minimum: 1, description: 'Todo id; required when action is toggle.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const state = await readState(context);
      switch (input?.action) {
        case 'list':
          return result('list', state, formatTodos(state.todos));
        case 'add': {
          const text = requiredText(input.text, 'text');
          if (state.todos.length >= MAX_TODOS) throw new Error(`Todo list is limited to ${MAX_TODOS} items.`);
          const todo = { id: state.nextId, text, done: false };
          state.todos.push(todo);
          state.nextId += 1;
          await writeState(context, state);
          return result('add', state, `Added todo #${todo.id}: ${todo.text}`, `#${todo.id} ${todo.text}`);
        }
        case 'toggle': {
          const id = positiveInteger(input.id, 'id');
          const todo = state.todos.find((item) => item.id === id);
          if (!todo) throw new Error(`Todo #${id} not found.`);
          todo.done = !todo.done;
          await writeState(context, state);
          return result('toggle', state, `Todo #${id} ${todo.done ? 'completed' : 'reopened'}.`, `#${id} ${todo.done ? 'done' : 'open'}`);
        }
        case 'clear': {
          const count = state.todos.length;
          const cleared = { todos: [], nextId: 1 };
          await writeState(context, cleared);
          return result('clear', cleared, `Cleared ${count} todos.`, `Cleared ${count}`);
        }
        default:
          throw new Error('action must be one of: list, add, toggle, clear.');
      }
    },
  });
}

async function readState(context) {
  const value = await context.state.get(STATE_KEY, 'thread');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { todos: [], nextId: 1 };
  const todos = Array.isArray(value.todos)
    ? value.todos.slice(0, MAX_TODOS).flatMap((item) => normalizeTodo(item))
    : [];
  const highestId = todos.reduce((highest, todo) => Math.max(highest, todo.id), 0);
  const nextId = Number.isInteger(value.nextId) && value.nextId > highestId ? value.nextId : highestId + 1;
  return { todos, nextId };
}

async function writeState(context, state) {
  await context.state.set(STATE_KEY, state, 'thread');
}

function normalizeTodo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  if (!Number.isInteger(value.id) || value.id < 1 || typeof value.text !== 'string' || !value.text.trim()) return [];
  return [{ id: value.id, text: value.text.trim(), done: value.done === true }];
}

function result(action, state, content, preview = content) {
  return {
    content,
    preview,
    data: { action, todos: state.todos.map((todo) => ({ ...todo })), nextId: state.nextId },
  };
}

function formatTodos(todos) {
  return todos.length
    ? todos.map((todo) => `[${todo.done ? 'x' : ' '}] #${todo.id}: ${todo.text}`).join('\n')
    : 'No todos.';
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const text = value.trim();
  if (text.length > 1_000) throw new Error(`${label} must be at most 1000 characters.`);
  return text;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
