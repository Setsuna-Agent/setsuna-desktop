const CUSTOM_ANSWER = '__setsuna_custom_answer__';
const MAX_OPTIONS = 19;

export default function activate(api) {
  api.registerTool({
    name: 'question',
    description: 'Ask the user one structured question with choices and an optional free-form answer.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user.' },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: MAX_OPTIONS,
          description: 'Two to nineteen choices for the user.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short choice label.' },
              description: { type: 'string', description: 'Optional explanation of the choice.' },
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const question = requiredText(input?.question, 'question');
      const options = normalizeOptions(input?.options);
      const selected = await context.ui.select({
        title: 'Structured Question',
        message: question,
        label: 'Choose an answer',
        options: [
          ...options.map((option, index) => ({
            value: String(index),
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
          })),
          {
            value: CUSTOM_ANSWER,
            label: '其他 / Other',
            description: '输入一个不在选项中的回答。',
          },
        ],
      });

      if (selected === null) {
        return {
          content: 'User cancelled the question.',
          preview: 'Question cancelled',
          data: { question, answer: null, custom: false },
        };
      }

      if (selected === CUSTOM_ANSWER) {
        const answer = await context.ui.input({
      title: 'Structured Question',
          message: question,
          label: 'Your answer',
          placeholder: '输入你的回答',
        });
        if (answer === null) {
          return {
            content: 'User cancelled the question.',
            preview: 'Question cancelled',
            data: { question, answer: null, custom: true },
          };
        }
        return {
          content: `User wrote: ${answer}`,
          preview: answer,
          data: { question, answer, custom: true },
        };
      }

      const index = Number(selected);
      const option = Number.isInteger(index) ? options[index] : undefined;
      if (!option) throw new Error('The selected question option is invalid.');
      return {
        content: `User selected ${index + 1}: ${option.label}`,
        preview: option.label,
        data: { question, answer: option.label, index, custom: false },
      };
    },
  });
}

function normalizeOptions(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_OPTIONS) {
    throw new Error(`options must contain between 2 and ${MAX_OPTIONS} entries.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`options[${index}] must be an object.`);
    }
    const label = requiredText(item.label, `options[${index}].label`);
    const description = optionalText(item.description);
    return { label, ...(description ? { description } : {}) };
  });
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
