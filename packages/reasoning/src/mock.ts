import type { ReasoningClient, ReasoningResult, ReasoningTask } from './client';

/**
 * Deterministic MOCK client: returns canned outputs per task name, costs
 * nothing, and is labelled mock. Outputs are still validated by the schema.
 */
export class MockReasoningClient implements ReasoningClient {
  readonly mode = 'mock' as const;
  readonly calls: string[] = [];
  constructor(private readonly outputs: Record<string, unknown>) {}

  async run<T>(task: ReasoningTask<T>): Promise<ReasoningResult<T>> {
    this.calls.push(task.name);
    if (!(task.name in this.outputs)) throw new Error(`MockReasoningClient: no canned output for ${task.name}`);
    return {
      output: task.schema.parse(this.outputs[task.name]),
      model: 'mock',
      servedByFallback: false,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costMicroUsd: 0,
      requestId: null,
      source: 'mock',
    };
  }
}
