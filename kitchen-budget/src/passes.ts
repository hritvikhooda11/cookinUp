// Cooking with more than one pass: pass 1 cooks the dish, every later pass tastes
// it and fixes it. Provider-neutral: the engine passes in its own model call.

import type { ApiEffort } from "./effort";
import type { StationAllocation } from "./allocate";

export interface CookRequest {
  prompt: string;
  maxTokens: number;
  apiEffort: ApiEffort;
  /** 1-based pass number. */
  pass: number;
  signal?: AbortSignal;
}

export interface CookResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model stopped at maxTokens. */
  truncated: boolean;
}

export type CallModel = (req: CookRequest) => Promise<CookResponse>;

export interface CookResult {
  text: string;
  passes: CookResponse[];
  inputTokens: number;
  outputTokens: number;
  /** The returned text was cut off (only when pass 1 itself was truncated). */
  truncated: boolean;
}

export function tasteAndFixPrompt(originalPrompt: string, previous: string): string {
  return [
    originalPrompt,
    "",
    "You already cooked this station once. Here is your previous output:",
    "<previous_output>",
    previous,
    "</previous_output>",
    "",
    "Taste it: check it against the goal and the inputs from other stations, and find mistakes, gaps and weak spots.",
    "Then return the complete improved output in the same JSON shape. Return only the JSON.",
  ].join("\n");
}

export async function cookStation(
  allocation: StationAllocation,
  prompt: string,
  call: CallModel,
  signal?: AbortSignal,
): Promise<CookResult> {
  const passes: CookResponse[] = [];
  let best: CookResponse | undefined;

  for (let pass = 1; pass <= allocation.passes; pass++) {
    signal?.throwIfAborted();
    const res = await call({
      prompt: best ? tasteAndFixPrompt(prompt, best.text) : prompt,
      maxTokens: allocation.maxTokensPerPass,
      apiEffort: allocation.apiEffort,
      pass,
      signal,
    });
    passes.push(res);
    // A cut-off refinement is worse than the finished dish it was refining: keep the dish.
    if (res.truncated && best) break;
    best = res;
    if (res.truncated) break;
  }

  return {
    text: best!.text,
    passes,
    inputTokens: passes.reduce((s, p) => s + p.inputTokens, 0),
    outputTokens: passes.reduce((s, p) => s + p.outputTokens, 0),
    truncated: best!.truncated,
  };
}

/**
 * Claude Messages API fields for one pass. Spread into messages.create().
 * max_tokens includes thinking tokens; effort sets how hard the model thinks.
 */
export function anthropicParams(allocation: StationAllocation) {
  return {
    max_tokens: allocation.maxTokensPerPass,
    output_config: { effort: allocation.apiEffort },
  };
}
