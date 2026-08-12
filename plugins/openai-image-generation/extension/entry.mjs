import {
  IMAGE_GENERATION_TOOL,
  imageGenerationRequest,
  imageGenerationToolResult,
} from './image-generation.mjs';

export default function activate(api) {
  api.registerTool({
    ...IMAGE_GENERATION_TOOL,
    async execute(input, context) {
      if (!context.imageGeneration) {
        throw new Error('The image-generation plugin requires the host-managed image generation bridge.');
      }
      const result = await context.imageGeneration.generate(imageGenerationRequest(input));
      return imageGenerationToolResult(result);
    },
  });
}
