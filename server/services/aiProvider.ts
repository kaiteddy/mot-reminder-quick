import { createOpenAI } from "@ai-sdk/openai";

// Shared AI provider setup — used by the AI router and by server-side generation
// (e.g. the Service Reset card created during a job-sheet print).
// Cheapest current OpenAI model (replaces the legacy gpt-4o-mini).
// Override via AI_MODEL env without a code change (e.g. gpt-5.4-mini for higher quality).
export const AI_MODEL = process.env.AI_MODEL || "gpt-5.4-nano";
// Technical reference content (guides/reset cards) where nano-tier quality visibly
// disappoints — defaults to the higher-quality mini tier instead.
export const AI_MODEL_GUIDE = process.env.AI_MODEL_GUIDE || "gpt-5.4-mini";
// Reading a plate or a 17-character VIN off a phone photo taken in a workshop — oblique angle,
// road dirt, low light, a VIN etched into a door pillar. It is the one place in the app where the
// cheap tier would actually cost money: one misread character silently attaches a job sheet to the
// wrong vehicle, and nothing downstream can catch it. So this defaults to the flagship rather than
// a mini/nano tier. gpt-5.5-pro is the slower, more accurate step up if scans prove unreliable in
// the bay; set AI_MODEL_VISION to change it without a deploy.
export const AI_MODEL_VISION = process.env.AI_MODEL_VISION || "gpt-5.5";

// OPENAI_API_KEY only. The Manus Forge gateway used to stand behind this as a fallback, but its
// credential was published in this repo for eight months and has been revoked — leaving the
// fallback in place would turn a missing key into a confusing 401 from a dead endpoint instead of
// a clear "not configured".
export const hasAIKey = () => Boolean(process.env.OPENAI_API_KEY);

export const getRuntimeProvider = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set — AI features are unavailable");
  return createOpenAI({ apiKey, headers: { Authorization: `Bearer ${apiKey}` } });
};
