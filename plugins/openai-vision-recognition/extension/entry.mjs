import {
  VISION_RECOGNITION_TOOL,
  visionRecognitionRequest,
  visionRecognitionToolResult,
} from './vision-recognition.mjs';

export default function activate(api) {
  api.registerTool({
    ...VISION_RECOGNITION_TOOL,
    async execute(input, context) {
      if (!context.visionRecognition) {
        throw new Error('The vision-recognition plugin requires the host-managed vision bridge.');
      }
      const result = await context.visionRecognition.analyze(visionRecognitionRequest(input));
      return visionRecognitionToolResult(result);
    },
  });
}
