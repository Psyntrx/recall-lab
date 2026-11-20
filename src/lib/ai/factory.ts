import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import type { AiProvider } from "./provider";
import { GroqProvider } from "./groq-provider";
import { OpenAiProvider } from "./openai-provider";

export function getAiProvider(): AiProvider {
  const providerPreference = config.aiProvider?.toLowerCase() ?? "groq";

  if (providerPreference === "groq") {
    if (config.groqApiKey || process.env.GROQ_API_KEY) {
      return new GroqProvider();
    }
    if (config.openaiApiKey || process.env.OPENAI_API_KEY) {
      return new OpenAiProvider();
    }
    throw new AppError(
      "No AI provider API key is configured. Add GROQ_API_KEY to your .env.local file and restart the server.",
      503,
      "MISSING_API_KEY"
    );
  }

  if (providerPreference === "openai") {
    if (config.openaiApiKey || process.env.OPENAI_API_KEY) {
      return new OpenAiProvider();
    }
    if (config.groqApiKey || process.env.GROQ_API_KEY) {
      return new GroqProvider();
    }
    throw new AppError(
      "No AI provider API key is configured. Add OPENAI_API_KEY or GROQ_API_KEY to your .env.local file and restart the server.",
      503,
      "MISSING_API_KEY"
    );
  }

  return new GroqProvider();
}
