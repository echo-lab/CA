import { getParticipantId } from "./utils/participant";

const LOG_API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5001";

let sessionLogs = [];
let sessionId = Date.now();
let userId = "";
let bookId = "";
let manualInterventions = 0;
let lastDecisionTime = null;
let sessionStarted = false;
let sessionEnded = false;
let currentPageNumber = 1;
// Line-tracking state. lastLineKey is "page:index" so we can detect transitions
// even when only the page or only the index changes.
let lastLineKey = null;
let pendingTurnSource = null;
let pendingTurnDirection = null;
let observedPageSrc = "";
let observerAttached = false;
let domObserver = null;
let storyRouteActive = false;
let teardownFns = [];
let historyPatched = false;
let hasPendingCSVFlush = false;

function now() {
  return Date.now();
}

function getWindow() {
  return typeof window !== "undefined" ? window : null;
}

function getDocument() {
  return typeof document !== "undefined" ? document : null;
}

function getHistoryUserState() {
  const win = getWindow();
  if (!win?.history?.state) return {};
  return win.history.state.usr || {};
}

function normalizeBookId(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function updateSessionMetadata() {
  const routeState = getHistoryUserState();
  if (!routeState || typeof routeState !== "object") return;

  if (routeState.id !== undefined && routeState.id !== null && routeState.id !== "") {
    bookId = normalizeBookId(routeState.id);
  }

  // The verified participant ID in sessionStorage is authoritative. Router
  // state only survives in memory, so a refresh or a direct hit on /Story would
  // otherwise log a blank user_id; the route-state values are kept purely as a
  // fallback for sessions started before an ID was stored.
  const storedUserId = getParticipantId();
  const routeUserId = storedUserId || routeState.participantId || routeState.userName || routeState.name;
  if (routeUserId !== undefined && routeUserId !== null && routeUserId !== "") {
    userId = String(routeUserId);
  }
}

function resetSessionState() {
  sessionLogs = [];
  sessionId = now();
  manualInterventions = 0;
  lastDecisionTime = null;
  sessionStarted = false;
  sessionEnded = false;
  currentPageNumber = 1;
  pendingTurnSource = null;
  pendingTurnDirection = null;
  observedPageSrc = "";
  hasPendingCSVFlush = false;
  lastLineKey = null;
  updateSessionMetadata();
}

function logEvent({
  event_type,
  page_number = "",
  latency_ms = "",
  line_index = "",
  direction = "",
  trigger = ""
}) {
  sessionLogs.push({
    session_id: sessionId,
    user_id: userId,
    book_id: bookId,
    event_type: event_type,
    timestamp: now(),
    page_number: page_number,
    latency_ms: latency_ms,
    manual_interventions: manualInterventions,
    line_index: line_index,
    direction: direction,
    trigger: trigger
  });
}

function startSession() {
  if (sessionStarted && !sessionEnded) return;
  updateSessionMetadata();
  sessionStarted = true;
  sessionEnded = false;
  logEvent({ event_type: "session_start", page_number: currentPageNumber });
}

function endSession() {
  if (!sessionStarted || sessionEnded) return;
  sessionEnded = true;
  logEvent({ event_type: "session_end", page_number: currentPageNumber });
  saveCSVToFile();
}

function aiDecidedToTurnPage() {
  if (sessionEnded) return;
  if (!sessionStarted) startSession();
  lastDecisionTime = now();
  logEvent({
    event_type: "ai_decision_to_turn_page",
    page_number: currentPageNumber
  });
}

function autoPageTurn(pageNumber) {
  if (!sessionStarted) startSession();

  const turnTime = now();
  const latency = lastDecisionTime ? turnTime - lastDecisionTime : "";

  currentPageNumber = pageNumber;

  logEvent({
    event_type: "page_turn",
    page_number: pageNumber,
    latency_ms: latency
  });

  lastDecisionTime = null;
}

function lineChange(pageNumber, lineIndex, meta = {}) {
  if (sessionEnded) return;
  if (!sessionStarted) startSession();

  const key = `${pageNumber}:${lineIndex}`;
  // De-dupe — useEffect can fire on re-render without a real change.
  if (key === lastLineKey) return;

  let direction = "";
  if (lastLineKey) {
    const [prevPage, prevIndex] = lastLineKey.split(":").map(Number);
    if (pageNumber > prevPage) direction = "forward";
    else if (pageNumber < prevPage) direction = "back";
    else if (lineIndex > prevIndex) direction = "forward";
    else if (lineIndex < prevIndex) direction = "back";
  }
  const trigger = meta.trigger || pendingTurnSource || "auto";

  logEvent({
    event_type: "line_change",
    page_number: pageNumber,
    line_index: lineIndex,
    direction,
    trigger
  });

  lastLineKey = key;
}

function manualPageTurn(pageNumber) {
  if (!sessionStarted) startSession();

  manualInterventions += 1;
  currentPageNumber = pageNumber;

  logEvent({
    event_type: "page_turn",
    page_number: pageNumber,
    latency_ms: ""
  });
}

function saveCSVToFile() {
  if (!sessionLogs.length) return;
  // POST to the server, which writes the per-session CSV. keepalive lets the
  // request survive the page-unload that often triggers this call.
  try {
    fetch(`${LOG_API_BASE}/api/log-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, rows: sessionLogs }),
      keepalive: true,
    })
      .then(async (res) => {
        // A 4xx is a *resolved* promise, so without this check a rejected
        // batch (e.g. a user_id that is not on the participant roster) would
        // discard the whole session with no signal at all.
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(`[log] save rejected ${res.status}:`, body);
        }
      })
      .catch((err) => console.warn("[log] save failed:", err?.message || err));
  } catch (err) {
    console.warn("[log] save failed:", err?.message || err);
  }
  hasPendingCSVFlush = false;
}

// LEGACY (as of the study-log cutover): everything from here down to
// attachDOMObserver infers page turns by diffing the page image's src, and
// dead-reckons currentPageNumber from those diffs. src/utils/studyLog.js now
// emits page_turn from real navigation state in useStoryNavigation, with
// accurate direction/trigger and a manual-intervention count that includes the
// Play button and Enter key.
//
// This path is kept running only so one pilot session can be diffed against the
// new stream. Its counter is separate module state, so the two do not interfere.
// Delete this block (and the pendingTurnSource click listener) once the diff
// confirms the new stream, per the migration plan.
function isStoryRoute() {
  const win = getWindow();
  if (!win?.location?.pathname) return false;
  return win.location.pathname.toLowerCase() === "/story";
}

function detectPageImage() {
  const doc = getDocument();
  return doc?.querySelector('img[alt="current page"]') || null;
}

function inferDirectionFromUI() {
  const doc = getDocument();
  const previousButton = doc?.querySelector(".previous-page-button");
  const nextButton = doc?.querySelector(".next-page-button");

  if (pendingTurnDirection) return pendingTurnDirection;
  if (previousButton && previousButton.matches(":focus")) return "back";
  if (nextButton && nextButton.matches(":focus")) return "forward";
  return "forward";
}

function handleActualPageTurn() {
  const direction = inferDirectionFromUI();
  const isManual = pendingTurnSource === "manual";
  const isBack = direction === "back";

  if (isBack) {
    currentPageNumber = Math.max(1, currentPageNumber - 1);
  } else {
    currentPageNumber += 1;
  }

  if (isManual) {
    manualPageTurn(currentPageNumber);
  } else {
    autoPageTurn(currentPageNumber);
  }

  pendingTurnSource = null;
  pendingTurnDirection = null;
}

function syncWithPageImage(forceStart = false) {
  if (!isStoryRoute()) return;

  updateSessionMetadata();

  const image = detectPageImage();
  if (!image) return;

  const src = image.currentSrc || image.src || "";

  if (!src) return;

  if (forceStart || !observedPageSrc) {
    observedPageSrc = src;
    currentPageNumber = 1;
    if (!sessionStarted) startSession();
    return;
  }

  if (src === observedPageSrc) return;

  observedPageSrc = src;
  handleActualPageTurn();
}

function handleRouteChange() {
  const onStoryRoute = isStoryRoute();

  if (onStoryRoute) {
    if (!storyRouteActive) {
      resetSessionState();
      storyRouteActive = true;
      queueMicrotask(() => syncWithPageImage(true));
    } else {
      syncWithPageImage();
    }
    return;
  }

  if (storyRouteActive) {
    endSession();
    storyRouteActive = false;
  }
}

function patchHistory() {
  const win = getWindow();
  if (!win?.history || historyPatched) return;

  const originalPushState = win.history.pushState.bind(win.history);
  const originalReplaceState = win.history.replaceState.bind(win.history);

  win.history.pushState = function pushState(...args) {
    const result = originalPushState(...args);
    handleRouteChange();
    return result;
  };

  win.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState(...args);
    handleRouteChange();
    return result;
  };

  teardownFns.push(() => {
    win.history.pushState = originalPushState;
    win.history.replaceState = originalReplaceState;
    historyPatched = false;
  });

  historyPatched = true;
}

function attachDOMObserver() {
  const doc = getDocument();
  if (!doc || observerAttached) return;

  const observe = () => {
    syncWithPageImage();
  };

  domObserver = new MutationObserver(observe);
  domObserver.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });

  observerAttached = true;
  teardownFns.push(() => {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    observerAttached = false;
  });
}

function attachPageTurnListeners() {
  const doc = getDocument();
  const win = getWindow();
  if (!doc || !win) return;

  const clickHandler = (event) => {
    const button = event.target?.closest?.("button");
    if (!button) return;

    if (button.classList.contains("previous-page-button") && !button.disabled) {
      pendingTurnSource = "manual";
      pendingTurnDirection = "back";
      return;
    }

    if (button.classList.contains("next-page-button") && !button.disabled) {
      pendingTurnSource = "manual";
      pendingTurnDirection = "forward";
    }
  };

  const popStateHandler = () => {
    handleRouteChange();
  };

  const unloadHandler = () => {
    if (storyRouteActive) {
      endSession();
    } else if (hasPendingCSVFlush) {
      saveCSVToFile();
    }
  };

  doc.addEventListener("click", clickHandler, true);
  win.addEventListener("popstate", popStateHandler);
  win.addEventListener("beforeunload", unloadHandler);
  win.addEventListener("pagehide", unloadHandler);

  teardownFns.push(() => {
    doc.removeEventListener("click", clickHandler, true);
    win.removeEventListener("popstate", popStateHandler);
    win.removeEventListener("beforeunload", unloadHandler);
    win.removeEventListener("pagehide", unloadHandler);
  });
}

function initializeLogging() {
  const win = getWindow();
  const doc = getDocument();

  if (!win || !doc) return;

  patchHistory();
  attachPageTurnListeners();
  attachDOMObserver();
  handleRouteChange();
}

function teardownLogging() {
  while (teardownFns.length) {
    const fn = teardownFns.pop();
    try {
      fn();
    } catch (error) {
    }
  }
}

hasPendingCSVFlush = true;

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeLogging, { once: true });
  } else {
    initializeLogging();
  }
}

const api = {
  logEvent,
  startSession,
  endSession,
  aiDecidedToTurnPage,
  autoPageTurn,
  manualPageTurn,
  lineChange,
  saveCSVToFile,
  initializeLogging,
  teardownLogging
};

if (typeof window !== "undefined") {
  window.jennieSessionLogger = api;
  window.aiDecidedToTurnPage = aiDecidedToTurnPage;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

export {
  logEvent,
  startSession,
  endSession,
  aiDecidedToTurnPage,
  autoPageTurn,
  manualPageTurn,
  lineChange,
  saveCSVToFile,
  initializeLogging,
  teardownLogging
};

export default api;
