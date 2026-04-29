let fs = null;
let path = null;

//environment set up
//checking if supports node modules
//if so load fs and path modules so we can wrie csv file
//if no fs paths are unavailable so no file writing
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

//variables that are going to be tracked throughout the current session
let sessionLogs = []; //arr of all logged events
let sessionId = Date.now(); //unique session id based on date
let userId = ""; //child name
let bookId = ""; //1, 2, or 3
let condition = ""; //c1, c2, c3
let manualInterventions = 0; //number of manual page turns
let lastDecisionTime = null; //timestamp when ai decides to turns page
let sessionStarted = false; 
let sessionEnded = false;
let currentPageNumber = 1; 
let lastAutoTurnPage = null; //helps detect false positives
let pendingTurnSource = null; //manual or null
let pendingTurnDirection = null; //prev or next
let pendingBackNavigation = false; //did the user go back?
let observedPageSrc = ""; //last image seen to then compare and check if on a new page
let observerAttached = false;
let domObserver = null;
let storyRouteActive = false; //is user on the story?
let teardownFns = [];
let historyPatched = false; //help avoid dup function overrides
let hasPendingCSVFlush = false;

//timestamp helper
function now() {
  return Date.now();
}

function getWindow() {
  return typeof window !== "undefined" ? window : null;
}

function getDocument() {
  return typeof document !== "undefined" ? document : null;
}

//getting the route state (user and book info)
function getHistoryUserState() {
  const win = getWindow();
  if (!win?.history?.state) return {};
  return win.history.state.usr || {};
}

//normalizing book id
function normalizeBookId(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

//updating session info in vars
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

//starting new session
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

//pushing an event to the log
function logEvent({
  event_type,
  page_number = "",
  page_turn_type = "",
  page_turn_direction = "",
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
    page_turn_direction: page_turn_direction,
    latency_ms: latency_ms,
    false_positive: false_positive,
    manual_interventions: manualInterventions
  });
}

//start session logging
function startSession() {
  if (sessionStarted && !sessionEnded) return;
  updateSessionMetadata();
  sessionStarted = true;
  sessionEnded = false;
  logEvent({ event_type: "session_start", page_number: currentPageNumber });
}

//end the session and save the csv
function endSession() {
  if (!sessionStarted || sessionEnded) return;
  sessionEnded = true;
  logEvent({ event_type: "session_end", page_number: currentPageNumber });
  saveCSVToFile();
}

//ai decision trigger
function aiDecidedToTurnPage() {
  if (sessionEnded) return;
  if (!sessionStarted) startSession();
  lastDecisionTime = now();
  logEvent({
    event_type: "ai_decision_to_turn_page",
    page_number: currentPageNumber
  });
}

//log the auto page turns
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
    page_turn_direction: "next",
    latency_ms: latency,
    false_positive: false
  });

  lastDecisionTime = null;
}

//logging manual page turns
function manualPageTurn(pageNumber, wentBack = false) {
  if (!sessionStarted) startSession();

  manualInterventions += 1;
  currentPageNumber = pageNumber;

  const falsePositive = Boolean(wentBack && lastAutoTurnPage === pageNumber + 1);

  logEvent({
    event_type: "page_turn",
    page_number: pageNumber,
    page_turn_type: "manual",
    page_turn_direction: wentBack ? "prev" : "next",
    latency_ms: "",
    false_positive: falsePositive
  });

  pendingBackNavigation = false;
}

function escapeCSV(value) {
  //makes values safe to write into csv
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function getLogsDirectory() {
  //where csv logs are saved
  if (!path) return null;
  return path.resolve(__dirname, "../../frontend/logs");
}

//writes all current session logs to one csv file
function saveCSVToFile() {
  if (!fs || !path || !sessionLogs.length) {
    return;
  }

  //columns in csv file
  const headers = [
    "session_id",
    "user_id",
    "book_id",
    "condition",
    "event_type",
    "timestamp",
    "page_number",
    "page_turn_type",
    "page_turn_direction",
    "latency_ms",
    "false_positive",
    "manual_interventions"
  ];

  //turn each log object into a csv row
  const rows = sessionLogs.map((obj) =>
    headers.map((header) => escapeCSV(obj[header] ?? "")).join(",")
  );

  //combine headers and rows into one csv string
  const csv = [headers.join(","), ...rows].join("\n");
  const logsDir = getLogsDirectory();

  if (!logsDir) return;

  //make logs folder if it does not exist
  fs.mkdirSync(logsDir, { recursive: true });

  //each session gets its own csv named with session id
  const filePath = path.join(logsDir, `session_${sessionId}.csv`);
  fs.writeFileSync(filePath, csv);
  hasPendingCSVFlush = false;
}

//checks if user is currently on story page
function isStoryRoute() {
  const win = getWindow();
  if (!win?.location?.pathname) return false;
  return win.location.pathname.toLowerCase() === "/story";
}

//finds the current page image in the story
function detectPageImage() {
  const doc = getDocument();
  return doc?.querySelector('img[alt="current page"]') || null;
}

//figures out if page turn was prev or next
function inferDirectionFromUI() {
  const doc = getDocument();
  const previousButton = doc?.querySelector(".previous-page-button");
  const nextButton = doc?.querySelector(".next-page-button");

  if (pendingTurnDirection) return pendingTurnDirection;
  if (previousButton && previousButton.matches(":focus")) return "prev";
  if (nextButton && nextButton.matches(":focus")) return "next";
  return "next";
}

//runs when page image changes so logger knows a turn happened
function handleActualPageTurn() {
  const direction = inferDirectionFromUI();
  const isManual = pendingTurnSource === "manual";
  const isBack = direction === "prev";

  //update page number based on direction
  if (isBack) {
    currentPageNumber = Math.max(1, currentPageNumber - 1);
  } else {
    currentPageNumber += 1;
  }

  //log page turn as manual or auto
  if (isManual) {
    manualPageTurn(currentPageNumber, isBack);
  } else {
    autoPageTurn(currentPageNumber);
  }

  //clear pending turn info after log is written
  pendingTurnSource = null;
  pendingTurnDirection = null;
}

//checks story page image and detects if it changed
function syncWithPageImage(forceStart = false) {
  if (!isStoryRoute()) return;

  updateSessionMetadata();

  const image = detectPageImage();
  if (!image) return;

  const src = image.currentSrc || image.src || "";

  if (!src) return;

  //first image seen starts the session on page 1
  if (forceStart || !observedPageSrc) {
    observedPageSrc = src;
    currentPageNumber = 1;
    if (!sessionStarted) startSession();
    return;
  }

  if (src === observedPageSrc) return;

  //image changed so a page turn happened
  observedPageSrc = src;
  handleActualPageTurn();
}

//starts logging on story route and ends logging when leaving it
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

 //wraps browser history so route changes trigger logging checks
function patchHistory() {
  const win = getWindow();
  if (!win?.history || historyPatched) return;

  const originalPushState = win.history.pushState.bind(win.history);
  const originalReplaceState = win.history.replaceState.bind(win.history);

  win.history.pushState = function pushState(...args) {
    //called when app navigates to a new route
    const result = originalPushState(...args);
    handleRouteChange();
    return result;
  };

  win.history.replaceState = function replaceState(...args) {
    //called when app replaces current route state
    const result = originalReplaceState(...args);
    handleRouteChange();
    return result;
  };

  teardownFns.push(() => {
    //puts original history functions back
    win.history.pushState = originalPushState;
    win.history.replaceState = originalReplaceState;
    historyPatched = false;
  });

  historyPatched = true;
}

//watches page image src changes inside the story page
function attachDOMObserver() {
  const doc = getDocument();
  if (!doc || observerAttached) return;

  const observe = () => {
    //re-check page image whenever DOM changes
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
    //stop watching DOM when logging is torn down
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    observerAttached = false;
  });
}

//listens for manual prev/next clicks and browser route changes
function attachPageTurnListeners() {
  const doc = getDocument();
  const win = getWindow();
  if (!doc || !win) return;

  const clickHandler = (event) => {
    //marks the next page image change as a manual turn
    const button = event.target?.closest?.("button");
    if (!button) return;

    if (button.classList.contains("previous-page-button") && !button.disabled) {
      pendingTurnSource = "manual";
      pendingTurnDirection = "prev";
      pendingBackNavigation = true;
      return;
    }

    if (button.classList.contains("next-page-button") && !button.disabled) {
      pendingTurnSource = "manual";
      pendingTurnDirection = "next";
    }
  };

  //handles browser back/forward navigation
  const popStateHandler = () => {
    handleRouteChange();
  };

  //saves logs if the user closes or leaves the page
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
    //remove event listeners when logging is torn down
    doc.removeEventListener("click", clickHandler, true);
    win.removeEventListener("popstate", popStateHandler);
    win.removeEventListener("beforeunload", unloadHandler);
    win.removeEventListener("pagehide", unloadHandler);
  });
}

//sets up all logging listeners
function initializeLogging() {
  const win = getWindow();
  const doc = getDocument();

  if (!win || !doc) return;

  patchHistory();
  attachPageTurnListeners();
  attachDOMObserver();
  handleRouteChange();
}

//runs all cleanup functions
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

//start logging after browser document is ready
if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeLogging, { once: true });
  } else {
    initializeLogging();
  }
}

//functions exposed for app code or tests
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
  //make logger available in browser console/global app code
  window.talemateSessionLogger = api;
  window.aiDecidedToTurnPage = aiDecidedToTurnPage;
}

if (typeof module !== "undefined" && module.exports) {
  //node/commonjs export
  module.exports = api;
}

//esm exports
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
