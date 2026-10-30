// The live evaluation owns synthetic data under a temporary directory, never the user's chats.
const evaluationModule = '../packages/desktop-runtime/test/evaluation/context-compaction-evaluation.ts';
const { runContextCompactionEvaluation } = await import(evaluationModule) as {
  runContextCompactionEvaluation(args: string[]): Promise<void>;
};
await runContextCompactionEvaluation(process.argv.slice(2));
