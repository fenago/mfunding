// Shared styling tokens for the Funder Contact tab and its panels.
//
// These were inlined in FunderContactDirectory.tsx until the validation and
// credential panels needed them too. Two copies of a colour scale drift —
// one gets darkened for contrast and the other does not — so there is one
// copy and both files import it.
//
// ⚠ THE `!` SUFFIXES ON ANCHOR COLOURS ARE LOAD-BEARING. These components
// mount inside the cheat sheet's `.fcs` wrapper, whose runtime-injected
// stylesheet carries the bare element rule `.fcs a{color:var(--accent-ink)}`
// (styles.tsx:143). That selector scores (0,1,1); a Tailwind utility like
// `text-white` scores (0,1,0) and LOSES. The first version of this tab
// shipped white-on-green in the source and dark-green-on-green on the screen:
// tsc passed, the build was green, and a grep of the bundle for `text-white`
// found it present and proved nothing — because the losing rule is injected
// at runtime and never appears in the CSS bundle at all. A human looking at
// the page was the only thing that caught it.
//
// So: never express a colour on an <a> here as a plain utility. The `!`
// suffix is Tailwind v4's important modifier. v3's prefix form `!text-white`
// does NOT compile under v4 — verify the emitted CSS, never assume.

export const INK = "text-[#0f2942] dark:text-[#e8eef5]";
export const INK_SOFT = "text-[#40546b] dark:text-[#a9b8c8]";
export const INK_FAINT = "text-[#6b7d92] dark:text-[#7d8ea0]";
export const LINE = "border-[#dfe6ee] dark:border-[#23303f]";

export const CHIP = "text-[10.5px] font-bold rounded-[5px] px-[7px] py-[2px] whitespace-nowrap";
export const CHIP_NEUTRAL = `${CHIP} bg-[#eef2f7] dark:bg-[#1b2836] text-[#42566c] dark:text-[#a9b8c8]`;
export const CHIP_LIVE = `${CHIP} bg-[#e6f4ec] dark:bg-[#123024] text-[#1f8a5b] dark:text-[#54c68d]`;
export const CHIP_WARN = `${CHIP} bg-[#faf1dd] dark:bg-[#2c2413] text-[#b7791f] dark:text-[#dcab55]`;
export const CHIP_BAD = `${CHIP} bg-[#fbeceb] dark:bg-[#2e1513] text-[#a5332d] dark:text-[#e57b74]`;

export const KEY = `text-[9.5px] font-extrabold tracking-[0.09em] uppercase ${INK_FAINT} mb-[4px]`;
export const NONE = `text-[12px] ${INK_FAINT} italic`;

/** A text input / textarea / select that matches the card chrome. */
export const FIELD =
  `font-[inherit] text-[12.5px] ${INK} bg-white dark:bg-[#0e1a26] border ${LINE} rounded-[8px] px-[10px] py-[7px] w-full ` +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#c08a2d]";

/** The primary action button. A <button>, so it needs no `!` — `.fcs a` cannot reach it. */
export const BTN_PRIMARY =
  "font-[inherit] text-[12px] font-extrabold rounded-[7px] px-[12px] py-[6px] cursor-pointer border-0 " +
  "bg-[#157049] text-white hover:bg-[#0f5536] disabled:opacity-40 disabled:cursor-not-allowed " +
  "dark:bg-[#54c68d] dark:text-[#08131c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d]";

export const BTN_QUIET =
  `font-[inherit] text-[11.5px] font-bold rounded-[7px] px-[10px] py-[5px] cursor-pointer border ${LINE} ` +
  `bg-white dark:bg-[#0e1a26] ${INK_SOFT} hover:bg-[#eef2f7] dark:hover:bg-[#1b2836] disabled:opacity-40 disabled:cursor-not-allowed ` +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d]";

export const ERRTEXT = "text-[12px] font-bold text-[#c0433d] dark:text-[#e57b74]";
export const WARNTEXT = "text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55]";
