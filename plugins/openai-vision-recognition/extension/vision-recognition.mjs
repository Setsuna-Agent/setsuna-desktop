const PROMPT_MAX_CHARS = 4_000;

export const VISION_RECOGNITION_TOOL = {
  name: 'analyze_image',
  description: [
    'Analyze a runtime-managed image attachment with the separately configured vision model.',
    'If you can inspect image attachments directly, do that instead and call this tool only when the user explicitly asks to use the configured vision model.',
    'If you cannot inspect images directly, call this tool before making claims about the image.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      attachment_id: {
        type: 'string',
        description: 'The attachment id from the runtime-managed attachment list for this thread.',
      },
      prompt: {
        type: 'string',
        maxLength: PROMPT_MAX_CHARS,
        description: 'The question or visual analysis task to send with the image.',
      },
    },
    required: ['attachment_id', 'prompt'],
  },
};

export function visionRecognitionRequest(value) {
  const input = objectRecord(value, 'analyze_image input must be an object.');
  const prompt = requiredString(input.prompt, 'prompt');
  if (prompt.length > PROMPT_MAX_CHARS) {
    throw new Error(`prompt must not exceed ${PROMPT_MAX_CHARS} characters.`);
  }
  return {
    attachment_id: requiredString(input.attachment_id, 'attachment_id'),
    prompt,
  };
}

export function visionRecognitionToolResult(value) {
  const result = objectRecord(value, 'The vision recognition bridge returned an invalid result.');
  const content = requiredString(result.content, 'content');
  const attachmentId = requiredString(result.attachmentId, 'attachmentId');
  const attachmentName = requiredString(result.attachmentName, 'attachmentName');
  return {
    content: `Vision model analysis for ${attachmentName}:\n${content}`,
    preview: content.slice(0, 240),
    data: {
      pluginId: 'openai-vision-recognition',
      attachmentId,
      providerId: requiredString(result.providerId, 'providerId'),
      modelId: requiredString(result.modelId, 'modelId'),
      model: requiredString(result.model, 'model'),
    },
    containsExternalContext: true,
  };
}

function objectRecord(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
