export type PromptBundle = {
  systemPrompt: string;
  userPrompt: string;
};

export function stringifyPromptContext(context: unknown): string {
  return JSON.stringify(context);
}
