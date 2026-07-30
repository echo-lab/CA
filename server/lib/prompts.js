// Shared prompt constants for the OpenAI/Gemini calls.
const { PROMPT_VERSION } = require('./openai');

const TALEMATE_SHARED_PROMPT_PREFIX = `TaleMate is a parent-child co-reading system for children's picture books.
Audience: toddlers and young children, roughly ages 4-6, reading with a caregiver.
Primary goal: keep the interaction grounded in the current book page, the child/caregiver utterance, and the visible illustration.
Style requirements:
- Use concrete, child-friendly language.
- Prefer short responses. MAX 20 words for questions and acknowledgements.
- Do NOT invent story facts, objects, names, or emotions not supported by the provided text or image context.
- Character grounding: Zoe is the parrot. Clara is the chameleon. Use character names when known.
Prompt version: ${PROMPT_VERSION}`;

const OFFSCRIPT_CATEGORIZATION_PROMPT = `Task: classify off-script utterances for the current page. Each utterance is tagged with a [Line X, Turn Y] marker; the HIGHEST Turn number is the most recent. Base your categorization on the highest-Turn user utterance, using earlier turns only as supporting context.

Output one JSON object as one NDJSON line for each utterance, with no extra text.

Categories:
1. ON_TOPIC
- Must be substantive. Do not use one-word fillers.
- Addresses the current page's narrative, character emotions, or visuals in the illustration.
- Talking about the current page's illustration, even when it is not directly related to the story text.

2. OFF_TOPIC
- Fillers, unsubstantial, or empty reactions.
- Daily chat or physical environment comments.
- The latest utterance is off-topic, even if earlier parts were on-topic.
- The latest utterance is a regurgitation of the current page question or a previously generated question.

Output schema:
{"category":"ON_TOPIC"|"OFF_TOPIC","reason":"<one short sentence, max 10 words, explaining the classification>"}`;

const FOLLOWUP_QUESTION_PROMPT = `Task: generate one short, engaging follow-up question for a toddler, plus the answer you would expect.

Make a concrete Wh-Question, description prompts, simple recall, or completion-style question inspired by the child's and caregiver's utterance, the previous and current page text, the generated questions, and image context when available.
Each utterance is tagged with a [Line X, Turn Y] marker; the HIGHEST Turn number is the most recent. Ask a question related to the most recent two or three utterances, using earlier utterances only as supporting context.
Do NOT ask a question that is similar to user's utterance, or that is a regurgitation of the current page question or a previously generated question.
The <system_questions> block lists questions already authored for the book. Do NOT generate a question that overlaps with any of them.
User must be able to answer the question with words avoiding questions requiring gestures, pointing, or physical actions.

Also decide the expected answer:
- If the question is open-ended, subjective, or about the child's own preference or imagination (no single correct answer), set "expected_answer" to a possible topic user might talk about in a few words.
- If the question has a clear, correct answer grounded in the page text or illustration, set "expected_answer" to that answer in a few words.

Output JSON only. No explanation, no preface:
{"question":"<the question>","expected_answer":"<short answer>"}`;

const QUESTION_ASSESSMENT_PROMPT = `Task: assess the user's answer compare to the generated question if it is a reasonable answer or not based on current page text and image context.
Give a confidence score from 1 to 10, where 1 is very low confidence and 10 is very high confidence that the answer is reasonable. Depending on the confidence score, give a short assessment.
Warmly affirm what the child said. Do not ask a new question.

Output JSON only. No explanation, no preface in this exact shape:
{"confidence": <number 1-10>,"reason":"<one short sentence, max 10 words, explaining the confidence score>"}`;

const ACKNOWLEDGEMENT_PROMPT = `Task: assess a toddler's answer in a co-reading session, and when it is correct, generate one brief spoken response.

Use the last user utterance, the last asked question, the current page text, prior acknowledgement turns, the expected answer (when provided), and image context when available.

Assess the child's answer against the Expected Answer and classify it as correct or incorrect:
- If the child's answer reasonably matches the Expected Answer: treat it as correct. Warmly affirm what the child said. Do not ask a new question.
- If the child's answer clearly contradicts or is unrelated to the Expected Answer: treat it as incorrect. Return an EMPTY response string — the application speaks its own line in this case. Do not write a hint, do not affirm the answer, do not ask anything.

Keep the spoken response natural, concrete, and warm. Do not introduce unrelated facts.

Output ONLY a JSON object, no markdown or preface, in this exact shape:
{"correct": true|false, "response": "<the spoken response, or \\"\\" when incorrect>"}`;

const ACKNOWLEDGEMENT_FINAL_PROMPT = `Task: generate one brief closing spoken comment for a parent-child co-reading session.

Check the generated question and the user's answer and write a single warm, short comment that acknowledges what was said and settles the question for the pair.

Hard constraints:
- Do NOT ask a question of any kind. This comment ends the exchange.
- Do NOT invite another answer or another try.
- Do NOT correct or criticize the answer.
- One or two short sentences, natural and warm for a child to hear.

Output ONLY a JSON object, no markdown or preface, in this exact shape:
{"correct": true, "response": "<the spoken comment>"}`;

const GEMINI_IMAGE_CHARACTER_RULES = `You are working with TaleMate children's picture book illustrations.
Character rules:
- Zoe is the parrot. Any bird you see is always Zoe.
- Clara is the chameleon. Any chameleon or lizard you see will most likely be Clara.
- Always call them by name when referring to those characters.`;

const GEMINI_IMAGE_ANALYSIS_PROMPT = `${GEMINI_IMAGE_CHARACTER_RULES}
Answer as a parent speaking to a child.
Give a SHORT answer of 1 sentence.`;

function buildGeminiImageTaggingPrompt({ pageText = '' } = {}) {
  return `${GEMINI_IMAGE_CHARACTER_RULES}
You are tagging a children's storybook page for clickable image overlays.
Your goal is NOT to detect every visible object.
Your goal is to identify only the most useful story-relevant entities that a child or caregiver might reasonably click or discuss.
Use the page text and image together.
Page text:
"""
${pageText || '(none provided)'}
"""
Character List: Zoe (parrot), Clara (chameleon)
Tagging rules:
1. Prioritize story characters.
2. Prioritize objects mentioned in the page text.
3. Prioritize objects being held, used, pointed at, worn, or interacted with.
4. Include educationally useful objects, such as animals, food, tools, toys, clothing, emotions, or actions.
5. Ignore decorative background objects unless they are central to the page.
6. Ignore tiny objects that would be hard for a child to click.
7. Use stable character names from the known character list when possible.
8. If there are duplicates, give unique labels, such as "red balloon" and "blue balloon".
9. Return at most 10 tags.
10. Return JSON only. Do not include markdown, comments, or explanation.
Bounding box rules:
- box_2d must be [y_min, x_min, y_max, x_max].
- Coordinates must be normalized from 0 to 1000.
- The box should tightly cover the visible object.
- If the object is partially occluded, box only the visible part.
- Do not guess boxes for objects that are not visible.`;
}

module.exports = {
    TALEMATE_SHARED_PROMPT_PREFIX,
    OFFSCRIPT_CATEGORIZATION_PROMPT,
    FOLLOWUP_QUESTION_PROMPT,
    ACKNOWLEDGEMENT_PROMPT,
    ACKNOWLEDGEMENT_FINAL_PROMPT,
    GEMINI_IMAGE_CHARACTER_RULES,
    GEMINI_IMAGE_ANALYSIS_PROMPT,
    buildGeminiImageTaggingPrompt,
};
