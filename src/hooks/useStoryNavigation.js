import { useRef, useCallback, useEffect } from "react";
import { lineChange, aiDecidedToTurnPage } from "../logGeneration";
import { resetOffScriptStateForPage } from "../utils/utteranceProcessor";
import * as studyLog from "../utils/studyLog";
import { getRoleLabel } from "../utils/roles";

function directionBetween(prev, page, index) {
  if (page !== prev.page) return page > prev.page ? "forward" : "back";
  if (index !== prev.index) return index > prev.index ? "forward" : "back";
  return "";
}

// Owns page/line navigation: next/previous, play, jump-to-line, the line-change
// trigger markers, and the auto-advance + lineChange logging effects. Reading
// playback (continueReading) and the cross-cutting clearQuestionUI come from
// Story and are passed in.
export function useStoryNavigation({
  state,
  setState,
  isPlaying,
  setIsPlaying,
  audioHasEnded,
  setAudioHasEnded,
  setIsButtonDisabled,
  continueReading,
  clearQuestionUI,
  clearQuestionUIRef,
  offScriptLogRef,
  dialogueRefs,
  tableContainerRef,
  navigate,
  isTraining,
  name,
  id,
  isAnyAudioPlaying,
  generatedQuestion,
  showAvatar,
  showAvatarRef,
  inAcknowledgementLoopRef,
}) {
  const pendingLineTriggersRef = useRef(new Map());
  const pendingUntargetedLineTriggerRef = useRef(null);
  const prevPageRef = useRef(null);
  const lastLineKeyRef = useRef(null);

  const markLineChangeTrigger = useCallback((trigger, target) => {
    if (target && Number.isFinite(target.page) && Number.isFinite(target.index)) {
      const key = `${target.page}:${target.index}`;
      const existing = pendingLineTriggersRef.current.get(key);
      if (existing === "manual" && trigger === "auto") return;
      pendingLineTriggersRef.current.set(key, trigger);
      return;
    }

    if (pendingUntargetedLineTriggerRef.current === "manual" && trigger === "auto") return;
    pendingUntargetedLineTriggerRef.current = trigger;
  }, []);
  const markNextLineChangeManual = useCallback((target) => {
    markLineChangeTrigger("manual", target);
  }, [markLineChangeTrigger]);
  const markNextLineChangeAutomatic = useCallback((target) => {
    markLineChangeTrigger("auto", target);
  }, [markLineChangeTrigger]);

  const gotoNextPage = () => {
    // Bypasses handleNextClick, so it needs its own count.
    studyLog.noteManualIntervention("next_button");

    clearQuestionUI();
    resetOffScriptStateForPage(offScriptLogRef);
    setAudioHasEnded(false);

    if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);

    setIsPlaying(prevIsPlaying => {
        return false;
    });

    if (state.page < state.pagesValues.length - 1) {

      for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
        state.pagesValues[state.page].text[i].Reading=false;
      }
      setState(prevState => {
        const nextState = { ...prevState, page: prevState.page + 1, index: 0 };
        markNextLineChangeManual({ page: nextState.page, index: nextState.index });
        return nextState;
      });
    } else {
      if (isTraining) navigate('/Home', { state: { name } });
      else navigate('/Survey', { state: { id, name } });
    }
  };

  const gotoPreviousPage = () => {
    studyLog.noteManualIntervention("prev_button");
    if (!audioHasEnded && isPlaying) setIsButtonDisabled(true);
    clearQuestionUI();

    resetOffScriptStateForPage(offScriptLogRef);

    setIsPlaying(prevIsPlaying => {
      return false;
    });
    for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
      state.pagesValues[state.page].text[i].Reading=false;
    }
    state.hasReachedEnd = false;
    if (state.page > 0) {
      setState(prevState => {
        const nextState = { ...prevState, page: prevState.page - 1, index: 0 };
        markNextLineChangeManual({ page: nextState.page, index: nextState.index });
        return nextState;
      });

    }
  };

  const handleNextClick = useCallback((trigger = "manual") => {
   // Single choke point for the Play button and the Enter hotkey — both reach
   // here via handlePlayClick. Only audio-end auto-advance passes "auto".
   if (trigger !== "auto") {
     studyLog.noteManualIntervention("play_button_or_enter");
   }

   const markLineChange = trigger === "auto"
     ? markNextLineChangeAutomatic
     : markNextLineChangeManual;

   if (state.pagesValues[state.page]?.text?.length - 1 >= state.index) {
       setAudioHasEnded(false);
       setState(prevState => {
         const isLastLine = prevState.index === prevState.pagesValues[prevState.page].text.length - 1;
         continueReading(
           prevState.pagesValues[prevState.page],
           prevState.index,
           state.CharacterRoles,
           isLastLine
         );
         const newState = {...prevState, index: prevState.index+1};
         markLineChange({ page: newState.page, index: newState.index });
         return newState;
       });
   } else {
        if (state.page < state.pagesValues.length - 1) {
          if (isPlaying) {
           setIsPlaying(false);
          } else {
           clearQuestionUI();
           resetOffScriptStateForPage(offScriptLogRef);
           setAudioHasEnded(false);
           for (let i=0; i<state.pagesValues[state.page]?.text?.length; i++){
             state.pagesValues[state.page].text[i].Reading=false;
           }
           setState(prevState => {
             const nextPage = prevState.pagesValues[prevState.page + 1];
             const isLastLine = nextPage.text.length === 1;
             continueReading(nextPage, 0, state.CharacterRoles, isLastLine);
             const nextState = {...prevState, page: prevState.page + 1, index: 1};
             markLineChange({ page: nextState.page, index: nextState.index });
             return nextState;
           });
            if (tableContainerRef.current) {
              tableContainerRef.current.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }
          }
        } else {
           if(state.pagesValues[state.page]?.text && state.pagesValues[state.page].text[state.index - 1]){
               state.pagesValues[state.page].text[state.index-1].Reading = false;
           }
           setState(prevState => ({
             ...prevState,
             hasReachedEnd: state.page === state.pagesValues.length - 1 && state.pagesValues[state.page].text.length === state.index
           }));
           setIsPlaying(false);
        }
   }

   if (dialogueRefs.current[state.index]) {
       dialogueRefs.current[state.index].scrollIntoView({
           behavior: "smooth",
           block: "center",
       });
   }
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [state, isPlaying, dialogueRefs, continueReading, markNextLineChangeAutomatic, markNextLineChangeManual]);

  const prevStates = useRef({ audioHasEnded, isPlaying, handleNextClick });

  useEffect(() => {

    prevStates.current = {
      audioHasEnded,
      isPlaying,
      handleNextClick,
    };

    if (audioHasEnded && isPlaying) {
        const hasMoreLinesOnPage =
          state.pagesValues[state.page]?.text?.length - 1 >= state.index;

        if (generatedQuestion && showAvatar && !hasMoreLinesOnPage) {
          setIsPlaying(false);
          setAudioHasEnded(false);
          setIsButtonDisabled(false);
          return;
        }
        // The missing call site that left latency_ms blank on every row: mark
        // the decision instant so the resulting page_turn can be timed.
        aiDecidedToTurnPage();
        studyLog.noteAiDecision();
        handleNextClick("auto");
        setAudioHasEnded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioHasEnded, isPlaying, handleNextClick, generatedQuestion, showAvatar, state.page, state.index, state.pagesValues]);

  useEffect(() => {
    if (showAvatarRef.current && inAcknowledgementLoopRef?.current) {
      clearQuestionUIRef.current();
    }
    const key = `${state.page}:${state.index}`;
    const targetedTrigger = pendingLineTriggersRef.current.get(key);
    if (targetedTrigger) {
      pendingLineTriggersRef.current.delete(key);
    }
    const trigger = targetedTrigger || pendingUntargetedLineTriggerRef.current || "auto";
    if (!targetedTrigger) {
      pendingUntargetedLineTriggerRef.current = null;
    }
    lineChange(state.page, state.index, { trigger });

    const prevPage = prevPageRef.current;
    if (prevPage !== null && prevPage !== state.page) {
      studyLog.pushEvent({
        event_type: "page_turn",
        page_index: state.page,
        line_index: state.index,
        direction: state.page > prevPage ? "forward" : "back",
        trigger,
        latency_ms: studyLog.consumeDecisionLatency(),
      });
      studyLog.flush();
    }
    prevPageRef.current = state.page;

    const currentLine = state.pagesValues[state.page]?.text?.[state.index - 1];
    const assigned = state.CharacterRoles?.find?.((o) => o.Character === currentLine?.Character);
    const role = getRoleLabel(assigned?.role);

    studyLog.pushEvent({
      role,
      event_type: "line_change",
      page_index: state.page,
      line_index: state.index,
      direction: lastLineKeyRef.current
        ? directionBetween(lastLineKeyRef.current, state.page, state.index)
        : "",
      trigger,
    });
    lastLineKeyRef.current = { page: state.page, index: state.index };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.page, state.index]);

  const jumpToLine = useCallback((lineIndex) => {
    setAudioHasEnded(false);
    setIsPlaying(true);
    setState(prevState => {
      const page = prevState.pagesValues[prevState.page];
      const isLastLine = lineIndex === page.text.length;

      const currentIdx = prevState.index - 1;
      if (currentIdx >= 0 && page.text[currentIdx]) {
        page.text[currentIdx].Reading = false;
      }

      for (let i = currentIdx + 1; i < lineIndex - 1; i++) {
        if (page.text[i]) {
          page.text[i].Reading = false;
        }
      }

      continueReading(page, lineIndex - 1, prevState.CharacterRoles, isLastLine);

      const nextState = { ...prevState, index: lineIndex };
      markNextLineChangeAutomatic({ page: nextState.page, index: nextState.index });
      return nextState;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueReading, markNextLineChangeAutomatic]);

  function handlePlayClick() {

    if (isAnyAudioPlaying) {
      return;
    }

    if (state.hasReachedEnd) {
      if (isTraining) navigate('/Home', { state: { name } });
      else navigate('/Survey', { state: { id, name } });
      return;
    }

    if(state.pagesValues[state.page].text.length === state.index && isPlaying){
      console.log("Too late pause the audio cuz it's the last line. ")
      return;
    }

    setIsPlaying(prevIsPlaying => {
      if (prevIsPlaying) {
        return false;
      } else {
        return true;
      }
    });

    if (!isPlaying) {
      if (state.index === 0 || state.pagesValues[state.page]?.text?.length === state.index) {
        handleNextClick("manual");
      } else {
        var currentCharacter = state.CharacterRoles.filter(obj => obj.Character === state.pagesValues[state.page].text[state.index - 1].Character);
        if (!currentCharacter[0].VA ||
            currentCharacter[0].role === "Parent" ||
            currentCharacter[0].role === "Child" ||
            currentCharacter[0].role === "Dummy") {
          handleNextClick("manual");
        }
      }
    } else {
    }
  }

  return {
    gotoNextPage,
    gotoPreviousPage,
    handleNextClick,
    handlePlayClick,
    jumpToLine,
    markNextLineChangeAutomatic,
    markNextLineChangeManual,
  };
}
