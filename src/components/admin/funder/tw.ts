// Tailwind classes for the funder disclosure blocks.
//
// These components used to require a `.fcs` ancestor plus an injected
// <style> block, because every rule was scoped under `.fcs` and the colour
// tokens were declared on it. That made them unmountable anywhere else: drop
// one on another page and it renders as unstyled divs with undefined CSS
// variables, while tsc passes, the build is green and a bundle grep for its
// text returns a hit. Styling that fails silently on a green build is exactly
// the class of bug this codebase keeps shipping.
//
// So the shared blocks carry their own classes now and depend on nothing.
// The cheat sheet's OWN cards still use the `.fcs` stylesheet for its page
// chrome — that file is untouched, and its rules for these class names remain
// in place but inert. Removing them is a separate pass, deliberately not
// bundled with a visual change: a dead-CSS sweep and a restyle in one diff is
// unreviewable, and the sweep is worthless until both mounts have been seen.
//
// Colours are the token values verbatim rather than nearest-Tailwind, because
// this has to be a faithful conversion someone can compare side by side, not a
// redesign. Light value first, `dark:` second, taken from `.fcs` and
// `.dark .fcs` in styles.tsx:
//   --ink #0f2942/#e8eef5   --ink-soft #40546b/#a9b8c8  --ink-faint #6b7d92/#7d8ea0
//   --line #dfe6ee/#23303f  --line-soft #eaeff5/#1a2733 --accent-ink #0a7a52/#57d7a5
//   --a #1f8a5b/#54c68d     --a-bg #e6f4ec/#123024      --b #2f6fb0/#6aa6e0
//   --b-bg #e7f0f9/#122238  --c #b7791f/#dcab55         --c-bg #faf1dd/#2c2413
//   --d #c0433d/#e57b74     --chip #eef2f7/#1b2836      --chip-ink #42566c/#a9b8c8

const INK = "text-[#0f2942] dark:text-[#e8eef5]";
const INK_SOFT = "text-[#40546b] dark:text-[#a9b8c8]";
const INK_FAINT = "text-[#6b7d92] dark:text-[#7d8ea0]";

export const FX = {
  // ── contact block ──
  contact: `border-t border-dashed border-[#dfe6ee] dark:border-[#23303f] pt-[9px] flex flex-col gap-[9px]`,
  cgroup: "",
  ck: `text-[9.5px] font-extrabold tracking-[0.09em] uppercase ${INK_FAINT} mb-[3px]`,
  cline: `text-[12.5px] ${INK} leading-[1.5] flex flex-wrap items-baseline gap-[6px]`,
  who: "font-bold",
  lbl: `${INK_FAINT} text-[11.5px] min-w-[52px]`,
  cnone: `text-[12px] ${INK_FAINT} italic`,
  // A warning, not body text: someone skimming past "this note contains what
  // looks like a credential" will go hunting for the value.
  cunk: "text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55]",
  cperson: "border-l-2 border-[#dfe6ee] dark:border-[#23303f] pl-[9px] mt-[6px]",
  // pre-wrap and the height cap are LOAD-BEARING, not cosmetic. These quotes are
  // multi-line prose — a funder's packet notes, the CONTESTED bullets. Without
  // pre-wrap they collapse into one unreadable blob; without the cap a single
  // long note pushes the rest of the block off screen.
  cnote: `border-l-[3px] border-[#2f6fb0] dark:border-[#6aa6e0] bg-[#e7f0f9] dark:bg-[#122238] rounded-r-lg px-[11px] py-[8px] text-[11.5px] ${INK} leading-[1.5] whitespace-pre-wrap max-h-[190px] overflow-auto`,
  cnoteK: "block text-[9.5px] font-extrabold tracking-[0.09em] uppercase text-[#2f6fb0] dark:text-[#6aa6e0] mb-[3px]",
  cmini:
    "font-[inherit] text-[10px] font-extrabold tracking-[0.06em] uppercase text-[#42566c] dark:text-[#a9b8c8] bg-[#eef2f7] dark:bg-[#1b2836] border-0 rounded-[5px] px-[6px] py-[2px] cursor-pointer shrink-0 hover:bg-[#0f9d6b]/20 hover:text-[#0a7a52] dark:hover:bg-[#2fc98d]/20 dark:hover:text-[#57d7a5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d] dark:focus-visible:outline-[#d9ab52]",
  // No rule existed for these under .fcs — inert hooks, kept so the markup
  // structure is unchanged and nobody thinks styling was dropped.
  cmail: "",
  cphone: "",

  // ── links block ──
  lrow: "flex flex-wrap items-baseline gap-[6px] text-[12.5px] leading-[1.5]",
  lk: `text-[11.5px] ${INK_FAINT} min-w-[74px]`,
  portal: "bg-[#e7f0f9] dark:bg-[#122238] rounded-lg px-[10px] py-[8px] flex flex-col gap-[5px]",
  pt: "text-[11px] font-extrabold tracking-[0.06em] uppercase text-[#2f6fb0] dark:text-[#6aa6e0]",
  cred: `text-[11.5px] ${INK_SOFT} leading-[1.45]`,
  credB: INK,
  // The withheld-credential message. Reads as a warning on purpose.
  credhold:
    "text-[11.5px] text-[#b7791f] dark:text-[#dcab55] bg-[#faf1dd] dark:bg-[#2c2413] rounded-[7px] px-[9px] py-[6px] leading-[1.45]",
  doclist: "flex flex-col gap-[4px]",
  docrow: "flex flex-wrap items-baseline gap-[6px] text-[12px]",
  dt: `text-[10px] font-extrabold tracking-[0.05em] uppercase ${INK_FAINT} bg-[#eef2f7] dark:bg-[#1b2836] rounded-[5px] px-[6px] py-[2px]`,
  docopen:
    "font-[inherit] text-[10.5px] font-extrabold tracking-[0.05em] uppercase text-[#0a7a52] dark:text-[#57d7a5] bg-transparent border-0 p-0 cursor-pointer underline",
  docerr: "text-[11.5px] font-semibold text-[#c0433d] dark:text-[#e57b74]",

  // ── program box ──
  prog: "border border-[#1f8a5b] dark:border-[#54c68d] bg-[#1f8a5b]/[0.07] dark:bg-[#54c68d]/[0.07] rounded-[10px] px-3 py-[10px] flex flex-col gap-2",
  ph: "text-[10px] font-extrabold tracking-[0.09em] uppercase text-[#1f8a5b] dark:text-[#54c68d]",
  pay: `text-[13.5px] font-extrabold ${INK}`,
  n: "text-[#1f8a5b] dark:text-[#54c68d]",
  progUl: "m-0 pl-4 flex flex-col gap-[5px] list-disc",
  progLi: `text-[11.5px] ${INK_SOFT} leading-[1.45]`,
  dgrid: "grid grid-cols-[repeat(auto-fit,minmax(108px,1fr))] gap-[6px]",
  dcell: "bg-[#eaeff5] dark:bg-[#1a2733] rounded-lg px-2 py-[6px]",
  k: `text-[9.5px] font-bold tracking-[0.09em] uppercase ${INK_FAINT}`,
  v: `text-[12.5px] font-bold ${INK} tabular-nums`,
  drow: `text-[12px] ${INK_SOFT} leading-[1.45]`,
  drowB: `${INK} font-bold`,
  chips: "flex flex-wrap gap-1",
  c: "text-[10.5px] font-bold bg-[#eef2f7] dark:bg-[#1b2836] text-[#42566c] dark:text-[#a9b8c8] rounded-[5px] px-[7px] py-[2px]",
} as const;

// The link-classification chips. These reach the DOM through LINK_CHIP.cls in
// @/lib/funderDisclosure — a VARIABLE, not a literal — so a className grep over
// the components does not find them. Converting the markup without converting
// LINK_CHIP would leave the three chips emitting `.fcs`-scoped names and
// rendering unstyled, on a green build.
const BCHIP = "text-[11px] font-bold px-2 py-[3px] rounded-[7px] whitespace-nowrap";
export const BCHIP_BASE = `${BCHIP} bg-[#eef2f7] dark:bg-[#1b2836] text-[#42566c] dark:text-[#a9b8c8]`;
export const BCHIP_OPEN = `${BCHIP} bg-[#e6f4ec] dark:bg-[#123024] text-[#1f8a5b] dark:text-[#54c68d]`;
export const BCHIP_WARN = `${BCHIP} bg-[#faf1dd] dark:bg-[#2c2413] text-[#b7791f] dark:text-[#dcab55]`;
