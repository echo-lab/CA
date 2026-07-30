const express = require('express');
const {
    openai,
    OPENAI_OFFSCRIPT_MODEL,
    OPENAI_OFFSCRIPT_REASONING_EFFORT,
    OPENAI_PROMPT_CACHE_KEY,
    OPENAI_PROMPT_CACHE_RETENTION,
    PROMPT_VERSION,
    bedrockOffscript, 
    logOpenAIUsage,
} = require('../lib/openai');
const { TALEMATE_SHARED_PROMPT_PREFIX, QUESTION_ASSESSMENT_PROMPT } = require('../lib/prompts');
const { buildAcknowledgementPayload } = require('../lib/payloads');
const { buildPageImageMessage } = require('../lib/pageImage');
const { generateGeminiTtsChunks } = require('../liveTTS');

const router = express.Router();
const USE_BEDROCK = process.env.OFFSCRIPT_PROVIDER === 'bedrock';
const offscript = USE_BEDROCK ? bedrockOffscript : openai;

router.post('/api/assessment', async (req, res) => {})