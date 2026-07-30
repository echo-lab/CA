// Role classification, in one place.
//
// The app distinguishes four kinds of reader, and the distinction was
// previously re-derived by hardcoded name comparisons in five separate files.
// "Dummy" is genuinely its own case: it is read by a human like Parent/Child,
// but it carries a real synthesized voice and is excluded from the voice-role
// preview UI — collapsing it into either bucket loses a study condition.

export const ROLE_KIND = {
  AI_MATE: "ai_mate",
  HUMAN_PARENT: "human_parent",
  HUMAN_CHILD: "human_child",
  HUMAN_DUMMY: "human_dummy",
};

const HUMAN_ROLE_KINDS = {
  Parent: ROLE_KIND.HUMAN_PARENT,
  Child: ROLE_KIND.HUMAN_CHILD,
  Dummy: ROLE_KIND.HUMAN_DUMMY,
};

export function getRoleKind(roleName) {
  return HUMAN_ROLE_KINDS[roleName] || ROLE_KIND.AI_MATE;
}

// Short label for the logs' `role` column: who read this line.
// Dummy gets its own label rather than being folded into parent — it is a
// distinct study condition (human-read, but carrying a synthesized voice), and
// silently labelling it "parent" would misattribute those lines.
const ROLE_LABELS = {
  [ROLE_KIND.HUMAN_PARENT]: "parent",
  [ROLE_KIND.HUMAN_CHILD]: "child",
  [ROLE_KIND.HUMAN_DUMMY]: "dummy",
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

// True for the six AI mate roles — the ones with a preview button and an
// avatar. The inverse of isHumanRead, named for how call sites read.
export function isVoiceRole(roleName) {
  return !isHumanRead(roleName);
}
