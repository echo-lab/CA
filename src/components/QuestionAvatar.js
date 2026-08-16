import React, { useEffect, useRef, useState } from "react";
import { useAudioStreamControl } from "../utils/AudioStreamControl";
import * as studyLog from "../utils/studyLog";
import AnswerButton from "./AnswerButton";

const THINKING_DOT_MS = 450;

export default function QuestionAvatar({ 
    questionHistory,
    showAvatar,
    inAcknowledgementLoop,
    avatarPhase,
    isThoughtRevealed,
    revealedQuestion,
    revealedAcknowledgement,
    isGeneratedQuestionPlaying,
    isPageQuestionPlaying,
    isAcknowledgementPlaying,
    narratorImage,
    frames,
    listeningImage,
    narratorRole,
    onSpeakGenerated,
    onPlaySound,
    isAnswering,
    answerSubmitted,
    answerDisabled,
    onAnswerToggle,
}) {
    const { isGeminiAudioPlaying } = useAudioStreamControl();
    const frameIndexRef = useRef(0);
    const [thinkingDots, setThinkingDots] = useState(1);

    function changeFrame() {
        const imgElement = document.getElementById("role-image");
        if (!imgElement) {
            console.warn("[changeFrame] role-image element not found in DOM");
            return;
        }
        const nextIdx = (frameIndexRef.current + 1) % frames.length;
        frameIndexRef.current = nextIdx;
        const nextSrc = frames[nextIdx];
        imgElement.src = nextSrc;
    }

    useEffect(() => {
        frames.forEach(src => { const img = new Image(); img.src = src; });
    }, [frames]);

    useEffect(() => {
        let intervalId = null;
        const anyPlaying = isGeneratedQuestionPlaying || isPageQuestionPlaying || isGeminiAudioPlaying || isAcknowledgementPlaying;
        console.log("[changeFrame] effect run", {
            anyPlaying,
            isGeneratedQuestionPlaying,
            isPageQuestionPlaying,
            isGeminiAudioPlaying,
            isAcknowledgementPlaying,
            showAvatar,
            framesLen: frames.length,
            role: narratorRole?.role,
        });
        if (anyPlaying) {
            intervalId = setInterval(changeFrame, 250);
        } else {
            frameIndexRef.current = 0;
            const imgElement = document.getElementById("role-image");
            if (imgElement) imgElement.src = (showAvatar && inAcknowledgementLoop) ? listeningImage : frames[0];
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [isGeneratedQuestionPlaying, isPageQuestionPlaying, isGeminiAudioPlaying, isAcknowledgementPlaying, showAvatar, inAcknowledgementLoop, listeningImage]);

    // From the closing click until the acknowledgement lands, the question is
    // replaced by a thinking panel — the old question staying up read as though
    // it were still waiting for an answer.
    const hasAcknowledgement = questionHistory.some(m => m.type === 'acknowledgement');
    const showThinking = Boolean(answerSubmitted) && !hasAcknowledgement;

    useEffect(() => {
        if (!showThinking) {
            setThinkingDots(1);
            return;
        }
        const intervalId = setInterval(() => setThinkingDots(d => (d % 3) + 1), THINKING_DOT_MS);
        return () => clearInterval(intervalId);
    }, [showThinking]);

    // Keep the character on screen whenever the avatar is active, even if there
    // are no messages yet (e.g. while categorization/acknowledgement is running).
    if (questionHistory.length === 0 && !showAvatar && !showThinking) return null;

        const isSpeaking = isGeneratedQuestionPlaying || isPageQuestionPlaying || isAcknowledgementPlaying;
        const latestIdx = questionHistory.length - 1;
        const latest = latestIdx >= 0 ? questionHistory[latestIdx] : null;

        const handleLatestClick = () => {
            if (!latest) return;
            // Logged before dispatch so clicks that turn into no-ops (a
            // acknowledgement bubble, or a play blocked by the audio lock) are
            // still recorded as clicks.
            studyLog.pushQuestion({
                question_id: latest.id,
                question_type: latest.type,
                event: 'clicked',
                question_text: latest.text || '',
            });
            if (latest.type === 'generated') onSpeakGenerated();
            else if (latest.type === 'acknowledgement') {/* no-op */}
            else onPlaySound();
            };

        const showAnswerButton = inAcknowledgementLoop && avatarPhase === 'question' && !answerSubmitted;

        return (
            <div className={`question-area ${showAvatar ? 'has-avatar' : ''}${showAnswerButton ? ' has-answer-button' : ''}`}>
                {showAvatar && (
                <div className="role-image-container">
                    <img
                    id="role-image"
                    src={narratorImage}
                    alt="Narrator"
                    onClick={handleLatestClick}
                    style={{ cursor: 'pointer' }}
                    />
                </div>
                )}
                <div className="question-history">
                {showThinking && (
                    <div className="question-message thinking latest" aria-live="polite" aria-label="Thinking">
                        <span className="thinking-dots">
                            {Array.from({ length: thinkingDots }, (_, i) => (
                                <span key={i} className="thinking-dot" />
                            ))}
                        </span>
                    </div>
                )}
                {!showThinking && questionHistory.map((msg, i) => {
                    const isLatest = i === latestIdx;
                    const isPrevious = i === latestIdx - 1;
                    const isLatestGenerated = isLatest && msg.type === 'generated';
                    const isLatestAcknowledgement = isLatest && msg.type === 'acknowledgement';
                    const showThoughtTeaser = isLatestGenerated && !isThoughtRevealed;
                    const displayText = showThoughtTeaser
                    ? 'I have a question!'
                    : isLatestGenerated
                        ? (revealedQuestion || msg.text)
                        : isLatestAcknowledgement
                        ? revealedAcknowledgement
                        : msg.text;
                    const isRevealing =
                    (isLatestGenerated && isThoughtRevealed && Boolean(revealedQuestion) && revealedQuestion.length < msg.text.length) ||
                    (isLatestAcknowledgement && Boolean(revealedAcknowledgement) && revealedAcknowledgement.length < msg.text.length);
                    const latestIsGenerated = latest?.type === 'generated';
                    const positionClass = avatarPhase === 'ack'
                    ? (isLatestAcknowledgement ? 'latest' : 'hidden')
                    : isLatest
                        ? 'latest'
                        : (latestIsGenerated ? 'hidden' : (isPrevious ? 'previous' : 'hidden'));
                    const classes = [
                    'question-message',
                    msg.type,
                    positionClass,
                    isLatest && isSpeaking ? 'speaking' : '',
                    ].filter(Boolean).join(' ');
                    return (
                    <div
                        key={msg.id}
                        className={classes}
                        onClick={isLatest ? handleLatestClick : undefined}
                        style={{ cursor: isLatest ? 'pointer' : 'default' }}
                    >
                        <span className="question-bubble-text">
                        {displayText}
                        {isRevealing && <span className="reveal-cursor">▍</span>}
                        </span>
                    </div>
                    );
                })}
                {showAnswerButton && (
                    <AnswerButton
                        isAnswering={isAnswering}
                        disabled={answerDisabled}
                        onClick={onAnswerToggle}
                    />
                )}
                </div>
            </div>
        );
}
