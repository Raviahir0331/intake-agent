import OpenAI, { APIConnectionError } from "openai";
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { AppConfig } from "../config";
import { isTemporaryFailure, withRetry } from "../shared/retry";
import { createRateLimiter } from "./rateLimiter";

/**
 * The agent talks to models through this interface, using the OpenAI chat format because Gemini,
 * Groq and Ollama all accept it. Tests and offline mode plug in a scripted model instead.
 */
export interface ChatModel {
  readonly name: string;
  complete(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionFunctionTool[],
  ): Promise<ChatTurn>;
}

export type ChatTurn = {
  message: ChatCompletionMessage;
  usage: TokenUsage;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export function createChatModel(llm: AppConfig["llm"]): ChatModel {
  if (!llm.apiKey) {
    throw new Error(
      "LLM_API_KEY is not set. Add it to .env, or run with --offline to skip the LLM.",
    );
  }

  // Retries are ours (see withRetry) so each one shows up in the logs.
  const client = new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseUrl,
    maxRetries: 0,
    timeout: 60_000,
  });
  const waitForTurn = createRateLimiter(llm.requestsPerMinute);

  return {
    name: llm.model,
    async complete(messages, tools) {
      const response = await withRetry(
        "llm",
        async () => {
          await waitForTurn();
          return client.chat.completions.create({
            model: llm.model,
            messages,
            tools,
            tool_choice: "auto",
            ...(llm.reasoningEffort ? { reasoning_effort: llm.reasoningEffort } : {}),
          });
        },
        {
          attempts: 4,
          baseDelayMs: 2_000,
          shouldRetry: (error) => error instanceof APIConnectionError || isTemporaryFailure(error),
        },
      );

      const message = response.choices[0]?.message;
      if (!message) throw new Error("LLM returned no choices");

      return {
        message,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
