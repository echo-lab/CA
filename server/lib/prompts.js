// Shared prompt constants for the OpenAI/Gemini calls.
const { PROMPT_VERSION } = require('./openai');

const JENNIE_SHARED_PROMPT_PREFIX = `JENNIE is a parent-child co-reading system for children's picture books.
Audience: pre-schoolers and young children, roughly ages 3-6, reading with a caregiver.
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

const FOLLOWUP_QUESTION_PROMPT = `Task: generate one short, engaging follow-up question for a pre-schooler, plus the answer you would expect.

Make a concrete Wh-Question, description prompts, simple recall, or completion-style question inspired by the child's and caregiver's utterance, the previous and current page text, the generated questions, and image context when available.
Each utterance is tagged with a [Line X, Turn Y] marker; the HIGHEST Turn number is the most recent. Ask a question related to the most recent two or three utterances, using earlier utterances only as supporting context.
Do NOT ask a question that is similar to user's utterance, or that is a regurgitation of the current page question or a previously generated question.
The <system_questions> block lists questions already authored for the book. Do NOT generate a question that overlaps with any of them.
User must be able to answer the question with words avoiding questions requiring gestures, pointing, or physical actions.

Also decide the expected answer:
- If the question is open-ended, subjective, or about the child's own preference or imagination (no single correct answer), set "expected_answer" to an empty string "".
- If the question has a clear, correct answer grounded in the page text or illustration, set "expected_answer" to that answer in a few words.

Output JSON only. No explanation, no preface:
{"question":"<the question>","expected_answer":"<short answer>"}`;

const CLICK_QUESTION_PROMPT = `Task: generate one short, engaging follow-up question for a preschooler that can be answered only by clicking or tapping one choice. Include the expected clicked answer.

Make a concrete Wh-Question that is inspired by the child's and caregiver's utterance, the previous and current page text, the generated questions, and image context when available.

The <tappable_objects> block lists every object that has a clickable region on this page. The answer MUST be exactly one of those labels, copied character for character.
- Never invent an object, and never choose something you can see in the picture but that is not in the list.
- If several listed objects would work, pick any one of them.
- Prefer an object a 3-6 year old can spot easily and that connects to the page text or what was just said.
- Phrase it as an instruction to click or tap, and keep it under 15 words.
- Never ask for a spoken answer, and never ask for any action other than clicking.
- The <system_questions> block lists questions already authored for this book. Do not overlap with them.

Example of a good question: "Which sleeping bag do you like more?" Expected answer: "blue sleeping bag" or "red sleeping bag"
Example of a bad question: "Tap a sofa" Expected answer: "sofa" (The question is simple clicking rather than a reasoning question.)
Example of a bad question: "Click a purple thing" Expected answer: "purple frame" (The question is simple clicking rather than a reasoning question.)

Output JSON only. No explanation, no preface:
{"question":"<the question>","answer_label":"<the exact label copied from tappable_objects>"}`;

const QUESTION_ASSESSMENT_PROMPT = `Task: assess the user's answer compare to the generated question if it is a reasonable answer or not based on current page text and image context.
Give a confidence score from 1 to 10, where 1 is very low confidence and 10 is very high confidence that the answer is reasonable. Depending on the confidence score, give a short assessment.
Warmly affirm what the child said. Do not ask a new question.

Output JSON only. No explanation, no preface in this exact shape:
{"confidence": <number 1-10>,"reason":"<one short sentence, max 10 words, explaining the confidence score>"}`;

const ACKNOWLEDGEMENT_PROMPT = `Task: respond to a pre-schooler's answer in a co-reading session with one brief spoken line.

Use the last user utterance, the last asked question, the current page text, prior acknowledgement turns, the Reference Answer (when provided), and image context when available.

Always respond warmly, whatever the child said. Never grade the answer and never tell the child they are wrong.
- When the answer fits the Reference Answer or the page: affirm what the child said and add one concrete detail from the page text or illustration.
- When it does not fit: still affirm the child's idea, then gently describe what the page or picture actually shows, so the child can notice it themselves.
- When there is no Reference Answer: the answer is the child's own idea, so simply affirm it.

Keep the spoken line natural, concrete, and warm. Do not ask a new question. Do not introduce unrelated facts.

Output ONLY the spoken line as plain text. No JSON, no markdown, no surrounding quotes, no preface.`;

const GEMINI_IMAGE_CHARACTER_RULES = `You are working with JENNIE children's picture book illustrations.
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
    JENNIE_SHARED_PROMPT_PREFIX,
    OFFSCRIPT_CATEGORIZATION_PROMPT,
    FOLLOWUP_QUESTION_PROMPT,
    CLICK_QUESTION_PROMPT,
    ACKNOWLEDGEMENT_PROMPT,
    GEMINI_IMAGE_CHARACTER_RULES,
    GEMINI_IMAGE_ANALYSIS_PROMPT,
    buildGeminiImageTaggingPrompt,
};
