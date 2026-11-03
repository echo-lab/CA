import { renderHook, act } from "@testing-library/react";
import {
  useChildQuestion,
  ASK_TAP_PROMPT,
  ASK_GIVE_UP_TEXT,
  ASK_FAILED_TEXT,
  QUIET_NO_TAP_MS,
  QUIET_TAP_NO_SPEECH_MS,
  QUIET_TAP_AFTER_SPEECH_MS,
  TAP_PROMPT_WAIT_MS,
} from "../useChildQuestion";
import { streamAcknowledgement } from "../../utils/InnerThoughtProcessStream";
import { cancelManualAnswer, endManualAnswer, setAwaitingQuestionAnswer } from "../../utils/utteranceProcessor";

jest.mock("../../utils/InnerThoughtProcessStream", () => ({
  streamAcknowledgement: jest.fn(async () => ({ acknowledgement: "That is Clara." })),
}));
jest.mock("../../utils/utteranceProcessor", () => ({
  cancelManualAnswer: jest.fn(),
  endManualAnswer: jest.fn(async () => ""),
  setAwaitingQuestionAnswer: jest.fn(),
}));
jest.mock("../../utils/studyLog", () => ({ pushEvent: jest.fn() }));

// A click at this position on a 200x100 image lands at (500, 250) in 0-1000 units.
const clickAt = (clientX = 100, clientY = 25) => ({
  clientX,
  clientY,
  currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) },
});

function setup() {
  const props = {
    book: 1,
    stateRef: { current: { page: 2, pagesValues: { 2: { text: [{ Dialogue: "<b>Hello</b> there" }] } } } },
    narratorRole: { VA: "Kore" },
    deepgramTranscript: "",
    inAcknowledgementLoop: false,
    playAcknowledgement: jest.fn(),
    askAnswerAgain: jest.fn(),
    closeAcknowledgementMode: jest.fn(),
    resetAcknowledgementRevealState: jest.fn(),
    stopSpeaking: jest.fn(),
    dropPendingQuestion: jest.fn(),
    setShowAvatar: jest.fn(),
    setInAcknowledgementLoop: jest.fn(),
    setAvatarPhase: jest.fn(),
    setAnswerSubmitted: jest.fn(),
    setQuestionHistory: jest.fn(),
  };
  const hook = renderHook((p) => useChildQuestion(p), { initialProps: props });
  const update = (changes) => hook.rerender({ ...props, ...changes });
  return { hook, props, update };
}

const flush = () => act(async () => {});
const wait = (ms) => act(async () => { jest.advanceTimersByTime(ms); });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  endManualAnswer.mockResolvedValue("");
});
afterEach(() => jest.useRealTimers());

// Runs the request playAcknowledgement would have made, and returns the callbacks.
async function runSend(props) {
  const callbacks = {
    onAcknowledgementReady: jest.fn(),
    onAudioChunk: jest.fn(),
    onAudioEnd: jest.fn(),
    onAudioError: jest.fn(),
  };
  const [, options] = props.playAcknowledgement.mock.calls[0];
  await options.send(callbacks);
  return callbacks;
}

describe("starting", () => {
  test("opens the mic window, shows the mate, and drops a waiting question", () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    expect(hook.result.current.askPhase).toBe("listening");
    expect(hook.result.current.canTapPicture).toBe(true);
    expect(props.dropPendingQuestion).toHaveBeenCalled();
    expect(setAwaitingQuestionAnswer).toHaveBeenCalledWith(true);
    expect(props.setInAcknowledgementLoop).toHaveBeenCalledWith(true);
  });

  test("a second press during a turn does nothing", () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    act(() => hook.result.current.startAsk());
    expect(props.dropPendingQuestion).toHaveBeenCalledTimes(1);
  });

  test("a tap before Ask is ignored", () => {
    const { hook } = setup();
    act(() => hook.result.current.handleAskTap(clickAt()));
    expect(hook.result.current.askTap).toBeNull();
  });
});

describe("the flow table", () => {
  test("speaks, then taps: the tap submits with what was said", async () => {
    const { hook, props, update } = setup();
    act(() => hook.result.current.startAsk());
    update({ deepgramTranscript: "what is this" });
    endManualAnswer.mockResolvedValue("what is this");

    act(() => hook.result.current.handleAskTap(clickAt()));
    expect(hook.result.current.askTap).toEqual({ x: 500, y: 250 });
    await flush();

    expect(props.playAcknowledgement).toHaveBeenCalledTimes(1);
    const [reply, options] = props.playAcknowledgement.mock.calls[0];
    expect(reply).toBe("what is this");
    expect(options.question).toBe("");
    expect(options.logType).toBe("child_answer");

    await runSend(props);
    expect(streamAcknowledgement.mock.calls[0][0]).toMatchObject({
      route: "/api/ask-question-stream",
      requestBody: {
        book: 1,
        currentPageNumber: 3,
        tap: { x: 500, y: 250 },
        transcript: "what is this",
        bookText: "Hello there",
        ttsVoiceName: "Kore",
      },
    });
  });

  test("taps, then speaks: waits for the words, then submits", async () => {
    const { hook, props, update } = setup();
    act(() => hook.result.current.startAsk());
    act(() => hook.result.current.handleAskTap(clickAt()));
    await wait(QUIET_TAP_NO_SPEECH_MS - 1);
    expect(props.playAcknowledgement).not.toHaveBeenCalled();

    update({ deepgramTranscript: "what's that" });
    endManualAnswer.mockResolvedValue("what's that");
    await wait(QUIET_TAP_AFTER_SPEECH_MS - 1);
    expect(props.playAcknowledgement).not.toHaveBeenCalled();
    await wait(1);
    await flush();
    expect(props.playAcknowledgement.mock.calls[0][0]).toBe("what's that");
  });

  test("taps, says nothing: submits with no transcript", async () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    act(() => hook.result.current.handleAskTap(clickAt()));
    await wait(QUIET_TAP_NO_SPEECH_MS);
    await flush();
    expect(props.playAcknowledgement.mock.calls[0][0]).toBe("");
  });

  test("no tap: asks for one, and keeps what was said for the answer", async () => {
    const { hook, props, update } = setup();
    act(() => hook.result.current.startAsk());
    update({ deepgramTranscript: "what is this" });
    endManualAnswer.mockResolvedValue("what is this");
    await wait(QUIET_NO_TAP_MS);
    await flush();

    expect(hook.result.current.askPhase).toBe("prompting");
    const [, options] = props.askAnswerAgain.mock.calls[0];
    expect(options.text).toBe(ASK_TAP_PROMPT);

    act(() => options.onSpoken());
    expect(hook.result.current.askPhase).toBe("awaitingTap");

    endManualAnswer.mockResolvedValue("");
    act(() => hook.result.current.handleAskTap(clickAt()));
    await flush();
    expect(props.playAcknowledgement.mock.calls[0][0]).toBe("what is this");
  });

  test("silent and no tap also asks for one", async () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    await wait(QUIET_NO_TAP_MS);
    await flush();
    expect(props.askAnswerAgain.mock.calls[0][1].text).toBe(ASK_TAP_PROMPT);
  });

  test("a tap during the prompt submits when the prompt ends", async () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    await wait(QUIET_NO_TAP_MS);
    await flush();
    act(() => hook.result.current.handleAskTap(clickAt()));
    expect(props.playAcknowledgement).not.toHaveBeenCalled();
    act(() => props.askAnswerAgain.mock.calls[0][1].onSpoken());
    await flush();
    expect(props.playAcknowledgement).toHaveBeenCalledTimes(1);
  });

  test("still no tap: says goodbye once and closes", async () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    await wait(QUIET_NO_TAP_MS);
    await flush();
    act(() => props.askAnswerAgain.mock.calls[0][1].onSpoken());

    await wait(TAP_PROMPT_WAIT_MS);
    expect(hook.result.current.askPhase).toBe("closing");
    expect(hook.result.current.canTapPicture).toBe(false);
    const [, goodbye] = props.askAnswerAgain.mock.calls[1];
    expect(goodbye.text).toBe(ASK_GIVE_UP_TEXT);

    act(() => goodbye.onSpoken());
    expect(hook.result.current.askPhase).toBe("idle");
    expect(props.closeAcknowledgementMode).toHaveBeenCalled();
    expect(props.askAnswerAgain).toHaveBeenCalledTimes(2);
    expect(props.playAcknowledgement).not.toHaveBeenCalled();
  });

  test("Send with no tap asks for one, and with a tap submits", async () => {
    const first = setup();
    act(() => first.hook.result.current.startAsk());
    act(() => first.hook.result.current.handleAskSend());
    await flush();
    expect(first.props.askAnswerAgain.mock.calls[0][1].text).toBe(ASK_TAP_PROMPT);

    const second = setup();
    act(() => second.hook.result.current.startAsk());
    act(() => second.hook.result.current.handleAskTap(clickAt()));
    act(() => second.hook.result.current.handleAskSend());
    await flush();
    expect(second.props.playAcknowledgement).toHaveBeenCalledTimes(1);
  });
});

describe("the ring", () => {
  test("a second tap before submitting moves it", () => {
    const { hook } = setup();
    act(() => hook.result.current.startAsk());
    act(() => hook.result.current.handleAskTap(clickAt(100, 25)));
    act(() => hook.result.current.handleAskTap(clickAt(20, 50)));
    expect(hook.result.current.askTap).toEqual({ x: 100, y: 500 });
  });

  test("stays up while answering and clears when the answer ends", async () => {
    const { hook, update } = setup();
    update({ inAcknowledgementLoop: false });
    act(() => hook.result.current.startAsk());
    update({ inAcknowledgementLoop: true });
    act(() => hook.result.current.handleAskTap(clickAt()));
    await wait(QUIET_TAP_NO_SPEECH_MS);
    await flush();
    expect(hook.result.current.askPhase).toBe("answering");
    expect(hook.result.current.askTap).not.toBeNull();

    update({ inAcknowledgementLoop: false });
    expect(hook.result.current.askPhase).toBe("idle");
    expect(hook.result.current.askTap).toBeNull();
  });
});

describe("failure and cancelling", () => {
  test("a failed request still shows a line", async () => {
    streamAcknowledgement.mockResolvedValueOnce(null);
    const { hook, props, update } = setup();
    act(() => hook.result.current.startAsk());
    update({ inAcknowledgementLoop: true });
    act(() => hook.result.current.handleAskTap(clickAt()));
    await wait(QUIET_TAP_NO_SPEECH_MS);
    await flush();
    const callbacks = await runSend(props);
    expect(callbacks.onAcknowledgementReady).toHaveBeenCalledWith(ASK_FAILED_TEXT);
  });

  test("cancelling while the answer loads aborts it, with no failure line", async () => {
    streamAcknowledgement.mockResolvedValueOnce(null);
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    act(() => hook.result.current.handleAskTap(clickAt()));
    await wait(QUIET_TAP_NO_SPEECH_MS);
    await flush();
    act(() => hook.result.current.cancelAsk());
    const callbacks = await runSend(props);
    expect(callbacks.onAcknowledgementReady).not.toHaveBeenCalled();
    expect(hook.result.current.askPhase).toBe("idle");
    expect(hook.result.current.askTap).toBeNull();
  });

  test("a page turn during the drain sends nothing", async () => {
    let finishDrain;
    endManualAnswer.mockReturnValueOnce(new Promise((resolve) => { finishDrain = resolve; }));
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    act(() => hook.result.current.handleAskTap(clickAt()));
    await wait(QUIET_TAP_NO_SPEECH_MS);
    act(() => hook.result.current.cancelAsk());
    await act(async () => finishDrain("late words"));
    expect(props.playAcknowledgement).not.toHaveBeenCalled();
  });

  test("cancelling during the prompt stops its audio, and a late end does nothing", async () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    await wait(QUIET_NO_TAP_MS);
    await flush();
    act(() => hook.result.current.cancelAsk());
    expect(props.stopSpeaking).toHaveBeenCalled();
    expect(cancelManualAnswer).toHaveBeenCalled();
    act(() => props.askAnswerAgain.mock.calls[0][1].onSpoken());
    expect(hook.result.current.askPhase).toBe("idle");
  });

  test("timers do not fire after a cancel", async () => {
    const { hook, props } = setup();
    act(() => hook.result.current.startAsk());
    act(() => hook.result.current.cancelAsk());
    await wait(QUIET_NO_TAP_MS * 3);
    expect(props.askAnswerAgain).not.toHaveBeenCalled();
  });

  test("cancelling when idle does nothing", () => {
    const { hook, props } = setup();
    act(() => hook.result.current.cancelAsk());
    expect(props.closeAcknowledgementMode).not.toHaveBeenCalled();
  });
});
