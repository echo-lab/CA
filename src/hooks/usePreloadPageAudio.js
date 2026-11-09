import { useEffect } from "react";
import { warmSay } from "../utils/warmSay";
import { stripSSMLTags } from "../utils/textNormalizer";

const PRELOAD_CONCURRENCY = 1;

function canon(text) {
  return stripSSMLTags(String(text || ""))
    .trim()
    .replace(/\s+/g, " ");
}

// Pre-synthesises the current and next page's computer-read lines and page
// questions, one at a time, so they play without a synthesis wait.
export function usePreloadPageAudio(state, narratorRole) {
  useEffect(() => {
    const current = state.pagesValues[state.page];
    const next = state.pagesValues[state.page + 1];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    if (!current?.text?.length) return;

    const voiceByChar = new Map();
    for (const opt of state.CharacterRoles || []) {
      if (opt.role === "Parent") continue;
      if (opt.VA) voiceByChar.set(opt.Character, { voiceName: opt.VA, role: opt.role });
    }

    const pagesToWarm = [current];
    if (next?.text?.length) pagesToWarm.push(next);

    // Warm page questions with the mate's voice, since that's who speaks them.
    const questionVoice = narratorRole?.VA
      ? { voiceName: narratorRole.VA, role: narratorRole.role }
      : null;
    const tasks = [];
    for (const page of pagesToWarm) {
      for (const line of page.text) {
        const charInfo = voiceByChar.get(line.Character);
        if (!charInfo) continue;
        const text = canon(line.Dialogue);
        if (!text) continue;
        tasks.push({
          text,
          voiceName: charInfo.voiceName,
          role: charInfo.role
        });
      }
      if (page.question && questionVoice) {
        tasks.push({
          text: page.question,
          voiceName: questionVoice.voiceName,
          role: questionVoice.role
        });
      }
    }
    if (!tasks.length) return;

    let i = 0;
    let running = 0;
    let stopped = false;

    const pump = () => {
      if (stopped) return;
      while (running < PRELOAD_CONCURRENCY && i < tasks.length) {
        const t = tasks[i++];
        running++;
        warmSay(t)
          .catch(() => {})
          .finally(async () => {
            running--;
            await sleep(400);
            queueMicrotask(pump);
          });
      }
    };

    pump();
    return () => { stopped = true; };
  }, [state.page, state.pagesValues, state.CharacterRoles, narratorRole]);
}
