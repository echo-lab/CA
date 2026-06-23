// Shared OpenAI client, prompt-cache config, and usage logging helpers.
const OpenAI = require('openai');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

const PROMPT_VERSION = 'talemate-offscript-v1';
const OPENAI_PROMPT_CACHE_KEY = PROMPT_VERSION;
const OPENAI_PROMPT_CACHE_RETENTION = '24h';
const OPENAI_OFFSCRIPT_MODEL = 'gpt-5.4-nano';
const OPENAI_OFFSCRIPT_REASONING_EFFORT = 'low';

function getCachedPromptTokens(usage) {
    return usage?.prompt_tokens_details?.cached_tokens ?? usage?.promptTokensDetails?.cachedTokens ?? null;
}

function logOpenAIUsage(label, usage) {
    if (!usage) return;
    console.log(`[${label}] OpenAI usage`, {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        cachedTokens: getCachedPromptTokens(usage),
    });
}

module.exports = {
    OpenAI,
    openai,
    OPENAI_API_KEY,
    PROMPT_VERSION,
    OPENAI_PROMPT_CACHE_KEY,
    OPENAI_PROMPT_CACHE_RETENTION,
    OPENAI_OFFSCRIPT_MODEL,
    OPENAI_OFFSCRIPT_REASONING_EFFORT,
    getCachedPromptTokens,
    logOpenAIUsage,
};
