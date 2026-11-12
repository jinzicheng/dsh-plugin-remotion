/**
 * dsh-plugin-remotion — the recipe skill.
 *
 * A second skill, deliberately separate from `remotion`: that one is the
 * authoring contract (what the kit is, what `meta` must look like, how to
 * render), this one is production design (how long, how fast, how big, what
 * colour). They are routed by different descriptions because they answer
 * different questions, and loading both for a one-line colour change would be
 * noise.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RECIPES_SKILL_NAME = 'video-recipes'

/** Loaded once at plugin load, alongside the authoring skill. */
const CONTENT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'recipes.md'), 'utf8')

/** The registration payload for `ctx.skills.register`. */
export const RECIPES_SKILL = {
  name: RECIPES_SKILL_NAME,
  description:
    'Ready-made recipes for the videos this machine makes: storyboard and timings for data animations, title cards, vertical short-form, counters, subtitle cards and split comparisons, plus audio (BGM, voiceover, ducking), cutting real footage by measurement (remotion_scan_video → trimBefore), and three transitions — with the exact font sizes, frame counts and palette the kit already uses, and a pre-delivery checklist.',
  whenToUse:
    'Use when deciding what a video should look like or how long each part should be — designing a new video, converting an existing one to vertical, pacing a data animation, adding music or voiceover, or cutting a clip the user sent into a highlight. Also use it for sizes, colours and transitions before writing the composition.',
  source: 'dsh-plugin-remotion',
  content: CONTENT,
}
