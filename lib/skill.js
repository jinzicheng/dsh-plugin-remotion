/**
 * dsh-plugin-remotion — the skill this plugin registers.
 *
 * The tools say what exists; this says how the kit is put together, what the
 * composition contract is, and which mistakes this installation has already
 * punished. The body is a Markdown file next to this module rather than a
 * template literal, so it can be edited as documentation instead of as escaped
 * JavaScript.
 *
 * `ctx.skills.register` publishes it as a normal skill, so it is routed by its
 * description and loaded on demand instead of inflating every session's prompt.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILL_NAME = 'remotion'

/** Loaded once at plugin load: ~5 KB of text, and it never changes at runtime. */
const CONTENT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'skill.md'), 'utf8')

/** The registration payload for `ctx.skills.register`. */
export const SKILL = {
  name: SKILL_NAME,
  description:
    'Make videos on this machine with Remotion: the one installed kit, how a composition is wired (meta, registry, Root), timeline and animation patterns, data-driven charts, and rendering to MP4 or stills.',
  whenToUse:
    'Use when a task involves producing or editing a video, motion graphic, animated chart, or title card — anything that should come out as an MP4 or a rendered frame.',
  source: 'dsh-plugin-remotion',
  content: CONTENT,
}
