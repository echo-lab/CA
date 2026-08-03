// Role classification, in one place.
//
// The app distinguishes three kinds of reader, and the distinction was
// previously re-derived by hardcoded name comparisons in five separate files.

export const ROLE_KIND = {
  AI_MATE: "ai_mate",
  HUMAN_PARENT: "human_parent",
  HUMAN_CHILD: "human_child",
};

const HUMAN_ROLE_KINDS = {
  Parent: ROLE_KIND.HUMAN_PARENT,
  Child: ROLE_KIND.HUMAN_CHILD,
};

export function getRoleKind(roleName) {
  return HUMAN_ROLE_KINDS[roleName] || ROLE_KIND.AI_MATE;
}

// Short label for the logs' `role` column: who read this line.
const ROLE_LABELS = {
  [ROLE_KIND.HUMAN_PARENT]: "parent",
  [ROLE_KIND.HUMAN_CHILD]: "child",
  [ROLE_KIND.AI_MATE]: "AI",
};

export function getRoleLabel(roleName) {
  if (!roleName) return "";
  return ROLE_LABELS[getRoleKind(roleName)] ?? "";
}

// True when a human reads this role aloud (so the mic should match against it
// and the app should not auto-play it).
export function isHumanRead(roleName) {
  return Boolean(HUMAN_ROLE_KINDS[roleName]);
}

// True for the AI mate roles — the ones with a preview button and an
// avatar. The inverse of isHumanRead, named for how call sites read.
export function isVoiceRole(roleName) {
  return !isHumanRead(roleName);
}
