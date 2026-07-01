// Shared user-message payload builders for the OpenAI calls.

function buildOpenAIDynamicPagePayload({
    currentPageQuestion,
    bookText,
    currentPageNumber,
    imageDescription,
    userAttention,
    utteranceTag,
    formattedUtterances,
    lastGeneratedQuestion,
    systemQuestions,
}) {
    const lastQuestionBlock = lastGeneratedQuestion
        ? `<last_question>\n"${lastGeneratedQuestion}"\n</last_question>\n`
        : '';
    const systemQuestionsBlock = Array.isArray(systemQuestions) && systemQuestions.length
        ? `<system_questions>\n${systemQuestions.map((q) => `- "${q}"`).join('\n')}\n(These questions are already authored for the book. Do NOT generate a question that overlaps with any of them.)\n</system_questions>\n`
        : '';
    return `<current_page>
Page: ${currentPageNumber || ''}
Book Text: ${bookText || ''}
Question: "${currentPageQuestion || ''}"
</current_page>
${(imageDescription || userAttention) ? `<image_context>\n${imageDescription ? `Description: ${imageDescription}` : ''}${imageDescription && userAttention ? '\n' : ''}${userAttention ? `User Attention: "${userAttention}"` : ''}\n</image_context>\n` : ''}${systemQuestionsBlock}${lastQuestionBlock}<${utteranceTag}>
${formattedUtterances}
</${utteranceTag}>`;
}

function buildReinforcementPayload({
    question,
    reply,
    currentPageQuestion,
    bookText,
    currentPageNumber,
    imageDescription,
    userAttention,
    reinforcementHistory,
    expectedAnswer,
}) {
    const history = Array.isArray(reinforcementHistory)
        ? reinforcementHistory
            .slice(-8)
            .map((turn, idx) => `[Turn ${idx + 1}] User: "${turn.user || ''}"\nResponse: "${turn.response || ''}"`)
            .join('\n')
        : '';

    return `<current_page>
Page: ${currentPageNumber || ''}
Book Text: ${bookText || ''}
Page Question: "${currentPageQuestion || ''}"
</current_page>
${(imageDescription || userAttention) ? `<image_context>\n${imageDescription ? `Description: ${imageDescription}` : ''}${imageDescription && userAttention ? '\n' : ''}${userAttention ? `User Attention: "${userAttention}"` : ''}\n</image_context>\n` : ''}<reinforcement_context>
Last Asked Question: "${question || currentPageQuestion || ''}"
Expected Answer: ${expectedAnswer ? `"${expectedAnswer}"` : '(open-ended — no single correct answer; affirm the child)'}
Latest User Utterance: "${reply || ''}"
${history ? `Prior Reinforcement Turns:\n${history}` : 'Prior Reinforcement Turns: none'}
</reinforcement_context>`;
}

module.exports = {
    buildOpenAIDynamicPagePayload,
    buildReinforcementPayload,
};
