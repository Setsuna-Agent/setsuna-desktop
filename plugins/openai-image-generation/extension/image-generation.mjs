export const IMAGE_GENERATION_TOOL = {
  name: 'generate_image',
  description: [
    'Generate one or more new images with the configured OpenAI-compatible Images API.',
    'Use only when the user explicitly asks to create a new image; this tool does not edit existing images.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', description: 'A detailed description of the image to generate.' },
      model: { type: 'string', description: 'Optional model override. Use only when the user explicitly requests a model.' },
      n: { type: 'integer', minimum: 1, maximum: 10, description: 'Number of variants for this same prompt. Omit for one image.' },
      size: { type: 'string', description: 'Provider-supported image size, for example 1024x1024.' },
      quality: { type: 'string', description: 'Provider-supported quality, for example auto, standard, hd, low, medium, or high.' },
      background: { type: 'string', description: 'Provider-supported background mode, for example auto, transparent, or opaque.' },
      output_format: { type: 'string', description: 'Provider-supported output format, for example png, jpeg, or webp.' },
      output_compression: { type: 'integer', minimum: 0, maximum: 100, description: 'Compression level for supported output formats.' },
      response_format: { type: 'string', description: 'Legacy response format, usually b64_json or url.' },
      style: { type: 'string', description: 'Provider-supported style, for example vivid or natural.' },
      moderation: { type: 'string', description: 'Provider-supported moderation level, for example auto or low.' },
    },
    required: ['prompt'],
  },
};

export function imageGenerationRequest(value) {
  const input = objectRecord(value, 'generate_image input must be an object.');
  return compactObject({
    prompt: requiredString(input.prompt, 'prompt'),
    model: optionalString(input.model, 'model'),
    n: optionalInteger(input.n, 1, 10, 'n'),
    size: optionalString(input.size, 'size'),
    quality: optionalString(input.quality, 'quality'),
    background: optionalString(input.background, 'background'),
    output_format: optionalString(input.output_format, 'output_format'),
    output_compression: optionalInteger(input.output_compression, 0, 100, 'output_compression'),
    response_format: optionalString(input.response_format, 'response_format'),
    style: optionalString(input.style, 'style'),
    moderation: optionalString(input.moderation, 'moderation'),
  });
}

export function imageGenerationToolResult(value) {
  const result = objectRecord(value, 'The image generation bridge returned an invalid result.');
  const attachments = Array.isArray(result.attachments) ? result.attachments : [];
  if (!attachments.length) throw new Error('图片生成服务未返回可用的图片。');
  const workspaceFiles = Array.isArray(result.workspaceFiles)
    ? result.workspaceFiles.filter((item) => item && typeof item === 'object' && typeof item.path === 'string')
    : [];
  const revisedPrompts = Array.isArray(result.revisedPrompts)
    ? result.revisedPrompts.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
  const model = optionalString(result.model, 'model');
  const size = optionalString(result.size, 'size');
  return {
    content: [
      `Generated ${attachments.length} image${attachments.length === 1 ? '' : 's'} successfully.`,
      ...(workspaceFiles.length
        ? [
            'Workspace files ready for publish_artifact (use these exact paths):',
            ...workspaceFiles.map((file) => `- ${file.path}`),
          ]
        : []),
      ...(revisedPrompts.length ? [`Revised prompt: ${revisedPrompts.join('\n')}`] : []),
    ].join('\n'),
    attachments,
    preview: `已生成 ${attachments.length} 张图片`,
    data: compactObject({
      pluginId: 'openai-image-generation',
      imageCount: attachments.length,
      workspaceFiles: workspaceFiles.length ? workspaceFiles : undefined,
      model,
      size,
    }),
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

function optionalString(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalInteger(value, minimum, maximum, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
