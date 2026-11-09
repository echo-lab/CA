import React, { useEffect, useRef, useState } from "react";
import { useAudioStreamControl } from "../utils/AudioStreamControl";
import * as studyLog from "../utils/studyLog";
import AnswerButton from "./AnswerButton";
import SendButton from "./SendButton";

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
    answerSubmitted,
    answerDisabled,
    onAnswerSubmit,
    sendBlink,
    isUserSpeaking,
    awaitingClick,
    onRequestQuestion,
    generatingQuestion,
    answerRetryText,
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

    // Between the closing click and the acknowledgement, show a thinking panel instead of the old question.
    const hasAcknowledgement = questionHistory.some(m => m.type === 'acknowledgement');
    const showThinking = Boolean(answerSubmitted) && !hasAcknowledgement;

    useEffect(() => {
        if (!showThinking && !generatingQuestion) {
            setThinkingDots(1);
            return;
        }
        const intervalId = setInterval(() => setThinkingDots(d => (d % 3) + 1), THINKING_DOT_MS);
        return () => clearInterval(intervalId);
    }, [showThinking, generatingQuestion]);

    // The mate is always on screen — it is the manual question button as well as
    // the speaker, so it has to be reachable even with nothing to say.

        const isSpeaking = isGeneratedQuestionPlaying || isPageQuestionPlaying || isAcknowledgementPlaying;
        const latestIdx = questionHistory.length - 1;
        const latest = latestIdx >= 0 ? questionHistory[latestIdx] : null;

        const handleLatestClick = () => {
            if (!latest) return;
            // Logged before dispatch so clicks that become no-ops are still recorded.
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

        // Tapping the mate replays a waiting question, otherwise asks for a new one.
        const hasUnheardQuestion = Boolean(latest) && latest.type === 'generated' && !isThoughtRevealed;
        // Ignore taps while the mate is talking or generating, so it isn't cut off or double-queued.
        const mateBusy = generatingQuestion || isSpeaking || isGeminiAudioPlaying;
        const handleAvatarClick = () => {
            if (mateBusy) return;
            if (hasUnheardQuestion) {
                handleLatestClick();
                return;
            }
            onRequestQuestion?.();
        };

        // Click questions are answered on the illustration, so the speech controls are hidden.
    const showAnswerButton = inAcknowledgementLoop && avatarPhase === 'question' && !answerSubmitted && !awaitingClick;

        return (
            <div className={`question-area ${narratorImage ? 'has-avatar' : ''}${showAnswerButton ? ' has-answer-button' : ''}`}>
                {/* Always shown when a mate was chosen (it's the question button); no mate means no avatar. */}
                {narratorImage && (
                <div className={`role-image-container${mateBusy ? ' is-busy' : ''}`}>
                    <img
                    id="role-image"
                    src={narratorImage}
                    alt={latest ? 'Narrator' : 'Ask for a question'}
                    title={latest ? '' : 'Ask me a question'}
                    onClick={handleAvatarClick}
                    />
                </div>
                )}
                <div className="question-history">
                {generatingQuestion && (
                    <div className="question-message generated latest" aria-live="polite">
                        <span className="question-bubble-text">
                            I am coming up with a new question{'.'.repeat(thinkingDots)}
                        </span>
                    </div>
                )}
                {/* The retry line replaces the dots instead of becoming a bubble, so it leaves no trace once spoken. */}
                {!generatingQuestion && showThinking && (
                    <div className="question-message thinking latest" aria-live="polite"
                         aria-label={answerRetryText || "Thinking"}>
                        {answerRetryText ? (
                            <span>{answerRetryText}</span>
                        ) : (
                            <span className="thinking-dots">
                                {Array.from({ length: thinkingDots }, (_, i) => (
                                    <span key={i} className="thinking-dot" />
                                ))}
                            </span>
                        )}
                    </div>
                )}
                {!generatingQuestion && !showThinking && questionHistory.map((msg, i) => {
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
                        // Key by render slot (stable across rewrites) so React doesn't replay the slide-in; falls back to id.
                        key={msg.slot || msg.id}
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
                    <div className="answer-controls">
                        <AnswerButton isUserSpeaking={isUserSpeaking} />
                        <SendButton
                            blink={sendBlink}
                            disabled={answerDisabled}
                            onClick={onAnswerSubmit}
                        />
                    </div>
                )}
                </div>
            </div>
        );
}
