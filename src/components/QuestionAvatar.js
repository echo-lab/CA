import React, { useEffect, useRef } from "react";
import { useAudioStreamControl } from "../utils/AudioStreamControl";

export default function QuestionAvatar({ 
    questionHistory,
    showAvatar,
    inReinforcementLoop,
    avatarPhase,
    isThoughtRevealed,
    revealedQuestion,
    revealedReinforcement,
    isGeneratedQuestionPlaying,
    isPageQuestionPlaying,
    isReinforcementPlaying,
    narratorImage,
    frames,
    listeningImage,
    narratorRole,
    onSpeakGenerated,
    onPlaySound,
}) {
    const { isGeminiAudioPlaying } = useAudioStreamControl();
    const frameIndexRef = useRef(0);

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
        const anyPlaying = isGeneratedQuestionPlaying || isPageQuestionPlaying || isGeminiAudioPlaying || isReinforcementPlaying;
        console.log("[changeFrame] effect run", {
            anyPlaying,
            isGeneratedQuestionPlaying,
            isPageQuestionPlaying,
            isGeminiAudioPlaying,
            isReinforcementPlaying,
            showAvatar,
            framesLen: frames.length,
            role: narratorRole?.role,
        });
        if (anyPlaying) {
            intervalId = setInterval(changeFrame, 250);
        } else {
            frameIndexRef.current = 0;
            const imgElement = document.getElementById("role-image");
            if (imgElement) imgElement.src = (showAvatar && inReinforcementLoop) ? listeningImage : frames[0];
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [isGeneratedQuestionPlaying, isPageQuestionPlaying, isGeminiAudioPlaying, isReinforcementPlaying, showAvatar, inReinforcementLoop, listeningImage]);

    if (questionHistory.length === 0) return null;

        const isSpeaking = isGeneratedQuestionPlaying || isPageQuestionPlaying || isReinforcementPlaying;
        const latestIdx = questionHistory.length - 1;
        const latest = questionHistory[latestIdx];

        const handleLatestClick = () => {
            if (latest.type === 'generated') onSpeakGenerated();
            else if (latest.type === 'reinforcement') {/* no-op */}
            else onPlaySound();
            };

        return (
            <div className={`question-area ${showAvatar ? 'has-avatar' : ''}`}>
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
                {questionHistory.map((msg, i) => {
                    const isLatest = i === latestIdx;
                    const isPrevious = i === latestIdx - 1;
                    const isLatestGenerated = isLatest && msg.type === 'generated';
                    const isLatestReinforcement = isLatest && msg.type === 'reinforcement';
                    const showThoughtTeaser = isLatestGenerated && !isThoughtRevealed;
                    const displayText = showThoughtTeaser
                    ? 'I have a thought.'
                    : isLatestGenerated
                        ? (revealedQuestion || msg.text)
                        : isLatestReinforcement
                        ? revealedReinforcement
                        : msg.text;
                    const isRevealing =
                    (isLatestGenerated && isThoughtRevealed && Boolean(revealedQuestion) && revealedQuestion.length < msg.text.length) ||
                    (isLatestReinforcement && Boolean(revealedReinforcement) && revealedReinforcement.length < msg.text.length);
                    const latestIsGenerated = latest?.type === 'generated';
                    const positionClass = avatarPhase === 'ack'
                    ? (isLatestReinforcement ? 'latest' : 'hidden')
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
                </div>
            </div>
        );
}
