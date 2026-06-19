import { roles } from "./Roles.js";
import { data as data1 } from "./Book1";
import { data as data2 } from "./Book2";
import { data as data3 } from "./Book3";
import { data as data4 } from "./Book4";

// Per-book character → human role mapping (a.k.a. "difficulty"). The Narrator is
// always voiced by Yellow Yancey and is handled separately in buildSelectedOptions.
export const DIFFICULTY_MAP = {
  // 1 = Birthday
  1: { Narrator: "", Clara: "Child", Zoe: "Parent" },
  // 2 = Sleepover
  2: { Narrator: "", Clara: "Child", Zoe: "Parent" },
  // 3 = Levels
  3: { Narrator: "", Clara: "Parent", Zoe: "Child" },
  // 4 = (Training) Levels — same roles as book 3
  4: { Narrator: "", Clara: "Parent", Zoe: "Child" },
};

function bookDataFor(id) {
  return id === 1 ? data1 : id === 2 ? data2 : id === 3 ? data3 : data4;
}

// Fully-determined character role assignments for a book, so the character
// selection screen can be skipped: the Narrator is always "Yellow Yancey", and
// the remaining characters take their Parent/Child role from DIFFICULTY_MAP.
export function buildSelectedOptions(id) {
  const characters = bookDataFor(id)?.[0]?.Book?.Characters || [];
  return characters.map((c) => {
    const roleName =
      c.Name === "Narrator" ? "Yellow Yancey" : DIFFICULTY_MAP[id]?.[c.Name];
    const r = roles.find((x) => x.Role === roleName);
    return r
      ? { Character: c.Name, VA: r.RoleParameter, role: r.Role, img: r.img }
      : { Character: c.Name, VA: undefined, role: roleName || "", img: undefined };
  });
}
