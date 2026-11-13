# Making videos with Remotion on this machine

Remotion renders React components to video. This machine has **one kit** — a
single Remotion project holding many videos — not one project per video. That is
the whole design: one 800 MB `node_modules`, one headless browser, and a new
video costs one file.

`remotion_status` reports where the kit is and whether it is healthy. Everything
below assumes it is.

## How the kit is wired

```
src/compositions/<Id>.tsx   one video each: exports `meta` and the component
src/registry.ts             GENERATED from those files — never edit by hand
src/Root.tsx                maps the registry onto <Composition> entries
scripts/kit.mjs             `sync` rewrites the registry, `list` prints JSON
public/                     data files and other assets
out/                        renders
.remotion-plugin/jobs/      render job records and logs
```

The id is load-bearing three times over: it is the file name, the exported
component name, and the registry import name. `BirthRate` means
`src/compositions/BirthRate.tsx` exporting `const BirthRate` with
`meta.id = 'BirthRate'`. `remotion_scaffold` enforces all of that; a hand-written
file must too, or `scripts/kit.mjs sync` fails with a message naming the file.

## The composition contract

```tsx
export const meta = {
  id: 'BirthRate',
  title: '中日韩出生率 1950–2023',
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 1144,
} as const;

export const BirthRate: React.FC = () => {
  /* ... */
};
```

**Every meta value must be a literal.** `scripts/kit.mjs` reads the block with a
small parser, not a compiler: `durationInFrames: fps * 10` is not a number to it,
and an imported constant is invisible. This is deliberate — it keeps registry
generation instant and dependency-free — so compute inside the component and put
the literal in meta.

After editing meta by hand, run `node scripts/kit.mjs sync` (or call
`remotion_scaffold`, which syncs too). `remotion_list` only shows what the
registry knows.

## Timeline arithmetic

- `useCurrentFrame()` starts at 0; a composition of `durationInFrames: N` runs
  frames 0…N-1.
- `interpolate(frame, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})`
  for anything that eases in or out. Without the clamps, values overshoot and the
  layout jumps at the ends.
- `Easing.out(Easing.cubic)` for entrances; `spring({frame, fps, config: {damping: 200}})`
  for anything that should settle.
- Pacing is a product decision. `BirthRate` gives each year 13 frames (0.43 s) —
  fast enough to hold attention, slow enough to read. State the pace in
  frames-per-beat when designing a new one.
- No unseeded randomness: the renderer draws frames in parallel and out of order,
  so `Math.random()` per frame produces different noise in every frame. Use
  Remotion's `random('seed-' + frame)`.

## Sequence lifetimes and Series

A `<Sequence>` with no `durationInFrames` renders until the composition ends. That
is how two cards end up on screen at once: the first one never stopped. Every
Sequence in a timed piece must state its own length, and the lengths must add up.

- **`<Series>` is the default.** Its children run one after another, and each
  `Series.Sequence` still needs `durationInFrames`. Nothing overlaps, so "the
  previous card has to finish first" is a property of the structure rather than a
  rule someone has to remember. Nest a Series for the sub-steps inside a card.
- **`<TransitionSeries>` only when the overlap is the point.** Every transition
  eats frames from the timeline: N transitions of D frames pull everything after
  them D frames earlier. With a beat-locked track that is audible — 10 fades of 12
  frames put the last card 4 seconds ahead of the music. If the audio is the clock,
  cut on the beat and keep any overlap inside one card.
- **`premountFor`** mounts a sequence that many frames early, so fonts, layout and
  data are already resolved when it becomes visible: 30–45 frames on a card, 15–30
  on a sub-step. Without it the first frame of every card is a fresh re-layout.
- **Assert the sum.** Keep the card durations in one array, derive the start frames
  from it, and throw in development when the total differs from
  `meta.durationInFrames`. A timeline that is a few frames short is invisible; one
  that is a card short is an accident you only notice in the render.

## Text, fonts, and Chinese

- System fonts only. A remote webfont is a network request the renderer may not
  make, and the fallback silently changes the layout.
- The stack that works here:
  `"Microsoft YaHei", "Noto Sans SC", "PingFang SC", "Segoe UI", system-ui, sans-serif`.
- Numbers that change frame to frame need `fontVariantNumeric: 'tabular-nums'`,
  or every digit change re-lays-out the line and the value visibly shivers.
- Check CJK text at its final size: 88 px titles fit, 20 px labels need weight
  and letter-spacing to stay legible at 1080p.

## Data videos

Data lives in `public/` as JSON and is imported directly — no fetch, no
`staticFile()` round trip:

```tsx
import raw from '../../public/birthrate.json';
```

The path is two levels up because compositions live in `src/compositions/`.
Yearly data animated between frames needs interpolation, not just the year's
value: find the previous and next points and lerp between them (`valueAt` in
`BirthRate.tsx` is the reference). Draw the partial path with `buildPath` so the
line grows with the year instead of appearing whole.

Cite the source in the frame when the numbers are not the user's own — a caption
line is enough, and `BirthRate` puts it under the title.

## Rendering

`remotion_render` starts a detached process and returns a job id; poll it with
`remotion_renders`.

- **A still first.** `format: "still"` at a representative frame costs ~40 s and
  catches every layout mistake. Render the MP4 once the design is settled.
- A 38 s 1080p30 video takes about **5 minutes** at concurrency 4. Lower
  concurrency if the machine is busy; each tab is a real browser.
- The first render on a fresh kit downloads a ~130 MB headless browser. If a
  render sits at "Bundling" or downloading, that is why.
- Output defaults to `out/<id>.mp4`. The ffprobe metadata in the job record
  (duration, codec, frames) is the cheapest way to confirm a render really
  produced what you promised.

## Quirks of this installation

- **Never call `npx remotion` from a tool.** The plugin spawns
  `node node_modules/@remotion/cli/remotion-cli.js` by absolute path, because the
  PATH inside a tool call may offer a different Node than the one that can run
  the renderer.
- **Windows temp is not writable from a sandboxed caller.** ffmpeg writes its
  intermediate `pre-encode.mp4` there and fails with `Permission denied`. The
  plugin points `TEMP`/`TMP` at the kit's own `.tmp`; doing it by hand means the
  same env vars.
- **The project path contains Chinese characters.** pnpm's default junction
  layout breaks `@remotion/cli` module resolution there (`Cannot find module
  'dotenv'`); `.npmrc` sets `node-linker=hoisted`. Do not "fix" that back.
- **PowerShell blocks unsigned scripts** on this machine, so `npm` only works as
  `npm.cmd`. The plugin does not care: it runs `node.exe` directly.
- `out/` holds renders that can always be regenerated; `node_modules` is the
  expensive part of the kit.

## Style baseline

The videos that already look right here share one visual system — reuse it unless
the user asks for something else:

- background `linear-gradient(160deg, #05070F, #0A1020 55%, #0C1730)` plus one or
  two soft radial glows;
- accents `#FF5A5F` (China), `#4C8DFF` (Japan), `#22D3A6` (South Korea) — one
  colour per series, used for the line, the dot and the number;
- text `#E9EEF8`, muted `#7D8FB0`, grid `#1B2740`;
- 1920×1080 at 30 fps: left column for the year and the numbers, right side for
  the chart, a 5 px progress bar along the bottom.

## Reporting back

Say what the video shows, the file path, its duration and size, and how to watch
it. If a render is still running, give the job id and say you will check it —
never imply the file is ready.
