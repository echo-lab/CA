// Shared prompt constants for the OpenAI/Gemini calls.
const { PROMPT_VERSION } = require('./openai');

const TALEMATE_SHARED_PROMPT_PREFIX = `TaleMate is a parent-child co-reading system for children's picture books.
Audience: toddlers and young children, roughly ages 4-6, reading with a caregiver.
Primary goal: keep the interaction grounded in the current book page, the child/caregiver utterance, and the visible illustration.
Style requirements:
- Use concrete, child-friendly language.
- Prefer short responses. MAX 20 words for questions and reinforcements.
- Do NOT invent story facts, objects, names, or emotions not supported by the provided text or image context.
- Character grounding: Zoe is the parrot. Clara is the chameleon. Use character names when known.
Prompt version: ${PROMPT_VERSION}`;

const OFFSCRIPT_CATEGORIZATION_PROMPT = `Task: classify off-script utterances for the current page. Each utterance is tagged with a [Line X, Turn Y] marker; the HIGHEST Turn number is the most recent. Anchor your categorization on the highest-Turn user utterance, using earlier turns only as supporting context.
The page question is only the scripted starter for the page — it is ONE of many valid topics, not the subject the utterance must match. Judge against the whole page (text and illustration), not against the page question.

Output one JSON object as one NDJSON line for each utterance, with no extra text.

Categories:
1. ON_TOPIC
- Must be substantive. Do not use for one-word fillers.
- Is about the book or the current page's illustration. It does NOT have to relate to the current page question — a different visual detail or object on the page (e.g. an item a character is wearing or holding) is ON_TOPIC.
- Addresses the current page's narrative, character emotions, or visual details.
- Shows accurate comprehension of the story, including correct character names.
- Can use pronouns or partial descriptions instead of character names when the meaning is clearly grounded in the current page.
- Talking about the current page's illustration, even if it is not directly related to the story text.

2. OFF_TOPIC
- NON_SUBSTANTIVE: Fillers, presence signals, or empty reactions.
- EXTERNAL: Daily chat or physical environment comments.
- RELEVANCY: The latest utterance is off-topic, even if earlier parts were on-topic.
- REPEAT: The latest utterance is a regurgitation of the current page question or a previously generated question.

Output schema:
{"category":"ON_TOPIC"|"OFF_TOPIC","reason":"<one short sentence, max 10 words, explaining the classification>"}`;

const FOLLOWUP_QUESTION_PROMPT = `Task: generate one short, engaging follow-up question for a toddler, plus the answer you would expect.

Prompt the child to say something about the book or expand the child's response by rephrasing and adding information to it.
Use the child's and caregiver's utterance, the previous and current page text, the generated questions, and image context when available.
Each utterance is tagged with a [Line X, Turn Y] marker; the HIGHEST Turn number is the most recent. Anchor your question on the highest-Turn user utterance, using earlier turns only as supporting context.
The page question is only the scripted starter for the page — do NOT fixate on it. Follow what the child actually brought up; any detail on the page or its illustration is fair game.
Previously generated questions appear in the same utterances marked (TaleMate Generated Question); go through them and do NOT repeat them.
Build on what the user noticed. Keep it natural, like a parent would ask. Prefer concrete Wh-Questions, description prompts, simple recall, or completion-style prompts.
User must be able to answer the question with words avoid questions requiring gestures, pointing, or physical actions.

Also decide the expected answer:
- If the question is open-ended, subjective, or about the child's own preference or imagination (no single correct answer), set "expected_answer" to null.
- If the question has a clear, correct answer grounded in the page text or illustration, set "expected_answer" to that answer in a few words.

Output JSON only. No explanation, no preface:
{"question":"<the question>","expected_answer":"<short answer>" or null}`;

const REINFORCEMENT_PROMPT = `Task: generate one brief spoken response for a toddler in a co-reading session.

Use the latest child/caregiver utterance, the last asked question, the current page text, prior reinforcement turns, the expected answer (when provided), and image context when available.

Assess the child's answer against the Expected Answer:
- If no Expected Answer is provided (open-ended question), or the child's answer reasonably matches it: warmly affirm what the child said. Do not ask a new question.
- If an Expected Answer IS provided and the child's answer clearly contradicts it (factually wrong): do NOT affirm the wrong answer and do NOT state the correct answer outright. Instead give a gentle correction that points toward the right idea. 

Keep the response natural, concrete, and warm. Do not introduce unrelated facts.

Output only the spoken response. No explanation, no preface.`;

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
    REINFORCEMENT_PROMPT,
    GEMINI_IMAGE_CHARACTER_RULES,
    GEMINI_IMAGE_ANALYSIS_PROMPT,
    buildGeminiImageTaggingPrompt,
};
