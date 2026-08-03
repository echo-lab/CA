// Shared OpenAI client, prompt-cache config, and usage logging helpers.
const OpenAI = require('openai');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

const PROMPT_VERSION = 'jennie-offscript-v2';
const OPENAI_PROMPT_CACHE_KEY = PROMPT_VERSION;
const OPENAI_PROMPT_CACHE_RETENTION = '24h';
const OPENAI_OFFSCRIPT_MODEL = 'gpt-5.4';
const OPENAI_OFFSCRIPT_REASONING_EFFORT = 'low';

function getCachedPromptTokens(usage) {
    return usage?.prompt_tokens_details?.cached_tokens ?? usage?.promptTokensDetails?.cachedTokens ?? null;
}

const BEDROCK_BASE_URL =
    process.env.BEDROCK_BASE_URL ||
    'https://bedrock-mantle.us-east-1.api.aws/openai/v1';

const BEDROCK_OFFSCRIPT_MODEL = process.env.BEDROCK_OFFSCRIPT_MODEL || 'openai.gpt-5.4';

let bedrockRawClient = null;
function getBedrockRawClient() {
    if (!process.env.BEDROCK_API_KEY) {
        throw new Error('BEDROCK_API_KEY not set');
    }
    if (!bedrockRawClient) {
        bedrockRawClient = new OpenAI({
            apiKey: process.env.BEDROCK_API_KEY,
            baseURL: BEDROCK_BASE_URL,
        });
    }
    return bedrockRawClient;
}

function toResponsesContent(content) {
    if (typeof content === 'string') {
        return [{ type: 'input_text', text: content }];
    }
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (part.type === 'text') return { type: 'input_text', text: part.text };
            if (part.type === 'image_url') {
                const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
                return { type: 'input_image', image_url: url };
            }
            return part;
        });
    }
    return [{ type: 'input_text', text: String(content ?? '') }];
}

function messagesToInput(messages) {
    return (messages || []).map((m) => ({
        role: m.role,
        content: toResponsesContent(m.content),
    }));
}

function buildResponsesParams(params) {
    const out = {
        model: BEDROCK_OFFSCRIPT_MODEL,
        input: messagesToInput(params.messages),
    };
    if (params.max_completion_tokens != null) out.max_output_tokens = params.max_completion_tokens;
    if (params.reasoning_effort) out.reasoning = { effort: params.reasoning_effort };

    const text = {};
    if (params.verbosity) text.verbosity = params.verbosity;
    if (params.response_format?.type === 'json_object') text.format = { type: 'json_object' };
    if (Object.keys(text).length) out.text = text;

    return out;
}

function mapBedrockUsage(u) {
    if (!u) return undefined;
    return {
        prompt_tokens: u.input_tokens,
        completion_tokens: u.output_tokens,
        total_tokens: u.total_tokens,
        completion_tokens_details: {
            reasoning_tokens: u.output_tokens_details?.reasoning_tokens,
        },
        prompt_tokens_details: {
            cached_tokens: u.input_tokens_details?.cached_tokens,
        },
    };
}

async function* streamAsChatChunks(responsesStream) {
    for await (const event of responsesStream) {
        switch (event.type) {
            case 'response.output_text.delta':
                yield { choices: [{ delta: { content: event.delta }, finish_reason: null }] };
                break;
            case 'response.completed':
                yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
                if (event.response?.usage) yield { choices: [], usage: mapBedrockUsage(event.response.usage) };
                break;
            case 'response.incomplete':
                yield { choices: [{ delta: {}, finish_reason: 'length' }] };
                if (event.response?.usage) yield { choices: [], usage: mapBedrockUsage(event.response.usage) };
                break;
            case 'response.failed':
            case 'error':
                throw new Error(event.response?.error?.message || event.message || 'Bedrock responses stream failed');
            default:
                break;
        }
    }
}

async function bedrockChatCompletionsCreate(params, options) {
    const client = getBedrockRawClient();
    const rparams = buildResponsesParams(params);

    if (params.stream) {
        rparams.stream = true;
        const stream = await client.responses.create(rparams, options);
        return streamAsChatChunks(stream);
    }

    const resp = await client.responses.create(rparams, options);
    return {
        choices: [{
            message: { content: resp.output_text ?? '' },
            finish_reason: resp.status === 'incomplete' ? 'length' : 'stop',
        }],
        usage: mapBedrockUsage(resp.usage),
    };
}

const bedrockOffscript = {
    chat: { completions: { create: bedrockChatCompletionsCreate } },
};

function logOpenAIUsage(label, usage) {
    if (!usage) return;
    console.log(`[${label}] OpenAI usage`, {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
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
    bedrockOffscript,
    BEDROCK_OFFSCRIPT_MODEL,
};
