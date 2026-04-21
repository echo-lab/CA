let fs = null;
let path = null;

try {
  const req = typeof require === "function" ? require : null;
  if (req) {
    fs = req("fs");
    path = req("path");
  }
} catch (error) {
  fs = null;
  path = null;
}

let sessionLogs = [];
let sessionId = Date.now();
let userId = "";
let bookId = "";
let condition = "";
let manualInterventions = 0;
let lastDecisionTime = null;
let sessionStarted = false;
let sessionEnded = false;
let currentPageNumber = 1;
let lastAutoTurnPage = null;
let pendingTurnSource = null;
let pendingTurnDirection = null;
let pendingBackNavigation = false;
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

  if (routeState.condition !== undefined && routeState.condition !== null) {
    condition = String(routeState.condition);
  }

  if (routeState.userName !== undefined && routeState.userName !== null && routeState.userName !== "") {
    userId = String(routeState.userName);
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
  lastAutoTurnPage = null;
  pendingTurnSource = null;
  pendingTurnDirection = null;
  pendingBackNavigation = false;
  observedPageSrc = "";
  hasPendingCSVFlush = false;
  updateSessionMetadata();
}

function logEvent({
  event_type,
  page_number = "",
  page_turn_type = "",
  latency_ms = "",
  false_positive = ""
}) {
  sessionLogs.push({
    session_id: sessionId,
    user_id: userId,
    book_id: bookId,
    condition: condition,
    event_type: event_type,
    timestamp: now(),
    page_number: page_number,
    page_turn_type: page_turn_type,
    latency_ms: latency_ms,
    false_positive: false_positive,
    manual_interventions: manualInterventions
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
  lastAutoTurnPage = pageNumber;

  logEvent({
    event_type: "page_turn",
    page_number: pageNumber,
    page_turn_type: "auto",
    latency_ms: latency,
    false_positive: false
  });

  lastDecisionTime = null;
}

function manualPageTurn(pageNumber, wentBack = false) {
  if (!sessionStarted) startSession();

  manualInterventions += 1;
  currentPageNumber = pageNumber;

  const falsePositive = Boolean(wentBack && lastAutoTurnPage === pageNumber + 1);

  logEvent({
    event_type: "page_turn",
    page_number: pageNumber,
    page_turn_type: "manual",
    latency_ms: "",
    false_positive: falsePositive
  });

  pendingBackNavigation = false;
}

function escapeCSV(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function getLogsDirectory() {
  if (!path) return null;
  return path.resolve(__dirname, "../../frontend/logs");
}

function saveCSVToFile() {
  if (!fs || !path || !sessionLogs.length) {
    return;
  }

  const headers = [
    "session_id",
    "user_id",
    "book_id",
    "condition",
    "event_type",
    "timestamp",
    "page_number",
    "page_turn_type",
    "latency_ms",
    "false_positive",
    "manual_interventions"
  ];

  const rows = sessionLogs.map((obj) =>
    headers.map((header) => escapeCSV(obj[header] ?? "")).join(",")
  );

  const csv = [headers.join(","), ...rows].join("\n");
  const logsDir = getLogsDirectory();

  if (!logsDir) return;

  fs.mkdirSync(logsDir, { recursive: true });

  const filePath = path.join(logsDir, `session_${sessionId}.csv`);
  fs.writeFileSync(filePath, csv);
  hasPendingCSVFlush = false;
}

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
    manualPageTurn(currentPageNumber, isBack);
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
      pendingBackNavigation = true;
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
  saveCSVToFile,
  initializeLogging,
  teardownLogging
};

if (typeof window !== "undefined") {
  window.talemateSessionLogger = api;
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
  saveCSVToFile,
  initializeLogging,
  teardownLogging
};

export default api;
