/**
 * dsh-plugin-remotion — the Cordis plugin.
 *
 * Remotion on this machine is one installed kit, not one project per video.
 * These tools treat the kit as a workshop: list what it can make, add a
 * composition, render it, and report on renders that are still running.
 *
 *   remotion_status     is the kit healthy, and which Node will render
 *   remotion_list       every composition the kit knows about
 *   remotion_scaffold   add a composition (blank scene, or a clone of one)
 *   remotion_render     render a composition to mp4 or a still
 *   remotion_renders    poll a render, or list the recent ones
 *
 * Host-only and dependency-free: Node's standard library, nothing else, so it
 * cannot fail to load because of a hoisting layout or a host version bump.
 *
 * Environment overrides:
 *   DSH_REMOTION_KIT    the kit directory (default: <home>/Desktop/作业/remotion-kit)
 *   DSH_REMOTION_NODE   the Node that runs the renderer
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import {
  JOB_LIST_LIMIT,
  PLUGIN_ROOT,
  chromeShellPath,
  fileSize,
  jobLogTail,
  kitCandidates,
  kitPath,
  kitProblem,
  kitTempDir,
  listCompositions,
  listJobs,
  readJob,
  remotionVersion,
  resolveNode,
  scanVideo,
  startRender,
  syncRegistry,
} from './kit.js'
import { SKILL } from './skill.js'
import { RECIPES_SKILL } from './recipes.js'
import { renameComposition, sceneTemplate } from './templates.js'
import { defineTool } from './tool.js'

export const name = 'tool-remotion'

/** `tools` is required; the prompt and skill registries are optional. */
export const inject = ['tools']

/** Sits just after the photoshop tool row. */
const PROMPT_SECTION_ORDER = 121

/** A composition id doubles as a file name and an import name. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/

/** Default render budget when the caller waits for the result. */
const DEFAULT_WAIT_TIMEOUT_MS = 1800000

/** How often a waiting render checks the job record. */
const POLL_INTERVAL_MS = 2000

/** Report sizes the way a person reads them. */
function humanBytes(bytes) {
  if (bytes === null || bytes === undefined) return 'unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Report a duration the way the job records it.
 * @param ms - milliseconds.
 * @returns e.g. `1m 12s`.
 */
function humanDuration(ms) {
  if (ms === null || ms === undefined) return 'unknown'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * One composition as a line of text.
 * @param entry - a `remotion_list` row.
 * @returns the line.
 */
function compositionLine(entry) {
  return (
    `- ${entry.id} — ${entry.title}\n` +
    `    ${entry.width}×${entry.height} @ ${entry.fps}fps · ${entry.durationInFrames} frames · ${entry.seconds}s\n` +
    `    ${entry.file}`
  )
}

/**
 * The kit's health, as a block of text.
 * @returns the report.
 */
function statusReport() {
  const lines = []
  const node = resolveNode()
  const version = spawnSync(node.path, ['-v'], { encoding: 'utf8', windowsHide: true })
  const nodeVersion = version.status === 0 ? (version.stdout ?? '').trim() : 'unavailable'

  lines.push(`dsh-plugin-remotion ${pluginVersion()}`)
  lines.push(`node: ${node.path} (${node.source}) ${nodeVersion}`)

  let kit = null
  try {
    kit = kitPath()
    lines.push(`kit: ${kit}`)
  } catch (error) {
    lines.push(`kit: NOT USABLE`)
    lines.push(`  ${String(error.message).split('\n').join('\n  ')}`)
    lines.push('')
    lines.push('Candidates:')
    for (const dir of kitCandidates()) lines.push(`  ${dir} — ${kitProblem(dir) ?? 'ok'}`)
    return lines.join('\n')
  }

  lines.push(`remotion: ${remotionVersion() ?? 'unknown'}`)
  lines.push(`headless browser: ${chromeShellPath() !== null ? 'downloaded' : 'NOT downloaded yet (the first render fetches ~130 MB)'}`)
  lines.push(`temp dir: ${kitTempDir()}`)

  try {
    const compositions = listCompositions()
    lines.push(`compositions: ${compositions.length}`)
    for (const entry of compositions) lines.push(compositionLine(entry))
  } catch (error) {
    lines.push(`compositions: unreadable — ${error.message}`)
  }

  const jobs = listJobs(4)
  if (jobs.length > 0) {
    lines.push('recent renders:')
    for (const job of jobs) {
      lines.push(`  ${job.id} ${job.composition} ${job.state}${job.state === 'done' ? ` → ${job.output}` : ''}`)
    }
  }
  return lines.join('\n')
}

/**
 * This package's own version, read from its manifest.
 * @returns the version string.
 */
function pluginVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Wait for a job to leave the running state.
 * @param jobId - the job to watch.
 * @param timeoutMs - how long to wait.
 * @param signal - abort signal from the tool call.
 * @returns the final record, or the last one seen on timeout.
 */
async function waitForJob(jobId, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = readJob(jobId)
    if (job.state !== 'running') return job
    if (Date.now() > deadline) return { ...job, timedOut: true }
    if (signal?.aborted === true) return { ...job, aborted: true }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS))
  }
}

/**
 * Render a finished job as text, including the log tail when it failed.
 * @param job - the job record.
 * @returns the report.
 */
function renderReport(job) {
  const lines = []
  if (job.state === 'done') {
    lines.push(`rendered ${job.composition} → ${job.output}`)
    lines.push(`  ${humanBytes(job.sizeBytes)} · took ${humanDuration(job.durationMs)} · job ${job.id}`)
    if (job.probe !== null && job.probe !== undefined) {
      const p = job.probe
      const bits = []
      if (p.width !== null && p.height !== null) bits.push(`${p.width}×${p.height}`)
      if (p.codec !== null) bits.push(p.codec)
      if (p.durationSeconds !== null) bits.push(`${p.durationSeconds}s`)
      if (p.frames !== null) bits.push(`${p.frames} frames`)
      if (bits.length > 0) lines.push(`  ${bits.join(' · ')}`)
    }
    return lines.join('\n')
  }
  if (job.state === 'running') {
    lines.push(`still rendering ${job.composition} (job ${job.id}, ${humanDuration(Date.now() - Date.parse(job.startedAt))} so far)`)
    lines.push(`  output: ${job.output}`)
    lines.push(`  log: ${job.log}`)
    const tail = jobLogTail(job.id, 6)
    if (tail !== '') lines.push('', 'last log lines:', tail)
    return lines.join('\n')
  }
  lines.push(`${job.composition} did not render (job ${job.id}, ${job.state})`)
  if (job.timedOut === true) lines.push('  the wait timed out; the render may still be running — poll it with remotion_renders')
  if (job.error) lines.push(`  ${String(job.error).split('\n').join('\n  ')}`)
  const tail = jobLogTail(job.id, 12)
  if (tail !== '') lines.push('', 'log tail:', tail)
  return lines.join('\n')
}

/**
 * Render a scan report as text: the probe on one line, then the cuts, the quiet
 * stretches and the clips worth keeping.
 * @param report - the scanner's output.
 * @returns the report.
 */
function scanReport(report) {
  const lines = []
  const audio = report.hasAudio ? report.audioCodec : 'no audio'
  lines.push(
    `${report.name} — ${report.duration}s, ${report.width}×${report.height} @ ${Number(report.fps).toFixed(2)}fps, ` +
      `${report.frames} frames, ${report.videoCodec} + ${audio}`,
  )

  if (report.scenes.length === 0) {
    lines.push('scene cuts: none found at this threshold (raise --scene sensitivity or cut by speech instead)')
  } else {
    lines.push(`scene cuts: ${report.scenes.length}`)
    for (const cut of report.scenes) lines.push(`  ${cut.time}s  (difference ${cut.score})`)
  }

  if (!report.hasAudio) {
    lines.push('silences: no audio track')
  } else if (report.silences.length === 0) {
    lines.push('silences: none — the track is continuous')
  } else {
    lines.push(`silences: ${report.silences.length}`)
    for (const silence of report.silences) {
      lines.push(`  ${silence.start}–${silence.end}s  (${(silence.end - silence.start).toFixed(2)}s quiet)`)
    }
  }

  if (report.speech.length > 0) {
    lines.push(`speech: ${report.speech.length} segment(s)`)
    for (const segment of report.speech) {
      lines.push(`  ${segment.start}–${segment.end}s  (${(segment.end - segment.start).toFixed(2)}s)`)
    }
  }

  lines.push(`suggested clips: ${report.clips.length}`)
  for (const clip of report.clips) {
    lines.push(`  ${clip.start}–${clip.end}s  (${clip.seconds}s) — ${clip.reason}`)
  }
  lines.push('')
  lines.push('Cut with <OffthreadVideo trimBefore={start*fps} durationInFrames={seconds*fps}> inside a <Sequence>.')
  return lines.join('\n')
}

/**
 * Resolve a user-supplied path against the kit, then the working directory.
 * @param file - the path as given.
 * @returns an absolute path that exists.
 */
function resolveInputPath(file) {
  const kit = kitPath()
  const candidates = isAbsolute(file) ? [file] : [join(kit, file), resolve(file)]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `no such file: ${file}\nlooked at:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
  )
}

/**
 * Register the Remotion tools, plus the prompt section and skill when their
 * registries exist.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  const tools = ctx.tools

  tools.register(
    defineTool({
      name: 'remotion_status',
      description:
        'Report the health of the local Remotion kit: where it lives, which Node will run the renderer, the installed Remotion version, whether the headless browser has been downloaded, and every composition the kit can produce. Read-only; call it first when a Remotion call fails for an unexplained reason, and before promising a video that the kit cannot make.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs: 120000,
      isConcurrencySafe: () => true,
      async execute() {
        return statusReport()
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'remotion_list',
      description:
        'List every video composition in the local Remotion kit with its id, title, pixel size, frame rate, duration and source file. Read-only. Use the id it returns for remotion_render and remotion_scaffold; never guess one.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs: 120000,
      isConcurrencySafe: () => true,
      async execute() {
        const compositions = listCompositions()
        if (compositions.length === 0) return 'the kit has no compositions yet — create one with remotion_scaffold'
        const total = compositions.reduce((sum, entry) => sum + entry.seconds, 0)
        return [
          `${compositions.length} compositions (${total.toFixed(1)}s of video in total):`,
          ...compositions.map(compositionLine),
        ].join('\n')
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'remotion_scaffold',
      description:
        'Add a video composition to the local Remotion kit. Without `from` it writes a blank scene (background, title, subtitle, progress bar) with commented animations to edit; with `from` it clones an existing composition — the fastest way to start a second data video, since the chart, the axes and the animation are already there. The registry is regenerated and verified before the tool returns, so the new id is immediately renderable. Every value in the generated `meta` block must stay a literal number or string.',
      parameters: {
        id: {
          type: 'string',
          required: true,
          description: 'Composition id: a JS identifier starting with a letter, e.g. "BirthRate". Becomes the file name and the registry import name.',
        },
        title: {
          type: 'string',
          description: 'Human title shown by remotion_list. Defaults to the id.',
        },
        subtitle: {
          type: 'string',
          description: 'Second line of the blank scene. Ignored when cloning.',
        },
        from: {
          type: 'string',
          description: 'Existing composition id to clone instead of starting from the blank scene.',
        },
        fps: { type: 'number', description: 'Frames per second. Default 30.' },
        width: { type: 'number', description: 'Pixel width. Default 1920 (or the cloned composition\'s).' },
        height: { type: 'number', description: 'Pixel height. Default 1080 (or the cloned composition\'s).' },
        duration_in_frames: { type: 'number', description: 'Length in frames. Default 300 (10s at 30fps), or the cloned composition\'s.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs: 180000,
      async execute(args) {
        const kit = kitPath()
        const id = String(args.id ?? '').trim()
        if (!ID_PATTERN.test(id)) {
          throw new Error(`id ${JSON.stringify(id)} is not a valid composition id: it must start with a letter and contain only letters and digits`)
        }
        const file = join(kit, 'src', 'compositions', `${id}.tsx`)
        if (existsSync(file)) throw new Error(`src/compositions/${id}.tsx already exists — pick another id, or edit that composition`)

        const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : id
        const existing = listCompositions()

        let source
        let clonedFrom = null
        if (typeof args.from === 'string' && args.from.trim() !== '') {
          const from = args.from.trim()
          const origin = existing.find((entry) => entry.id === from)
          if (origin === undefined) {
            throw new Error(`no composition ${JSON.stringify(from)} to clone. Available: ${existing.map((e) => e.id).join(', ') || '(none)'}`)
          }
          const originFile = join(kit, origin.file)
          source = renameComposition(
            readFileSync(originFile, 'utf8'),
            {
              id,
              title,
              fps: typeof args.fps === 'number' ? args.fps : undefined,
              width: typeof args.width === 'number' ? args.width : undefined,
              height: typeof args.height === 'number' ? args.height : undefined,
              durationInFrames: typeof args.duration_in_frames === 'number' ? args.duration_in_frames : undefined,
            },
            from,
          )
          clonedFrom = from
        } else {
          const fps = typeof args.fps === 'number' ? args.fps : 30
          const durationInFrames = typeof args.duration_in_frames === 'number' ? args.duration_in_frames : fps * 10
          source = sceneTemplate({
            id,
            title,
            subtitle: typeof args.subtitle === 'string' && args.subtitle.trim() !== '' ? args.subtitle.trim() : '副标题写在这里',
            fps,
            width: typeof args.width === 'number' ? args.width : 1920,
            height: typeof args.height === 'number' ? args.height : 1080,
            durationInFrames,
          })
        }

        writeFileSync(file, source, 'utf8')
        const synced = syncRegistry()
        const after = listCompositions()
        const created = after.find((entry) => entry.id === id)
        if (created === undefined) {
          throw new Error(`wrote src/compositions/${id}.tsx but the registry does not list it — run node scripts/kit.mjs sync and check the file's meta block`)
        }
        return [
          `created ${id}${clonedFrom !== null ? ` (cloned from ${clonedFrom})` : ''}`,
          `  src/compositions/${id}.tsx`,
          `  ${created.width}×${created.height} @ ${created.fps}fps · ${created.durationInFrames} frames · ${created.seconds}s`,
          `  ${synced}`,
          '',
          'Next: edit that file, then remotion_render with composition "' + id + '".',
        ].join('\n')
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'remotion_scan_video',
      description:
        'Look inside a video file before editing it: duration, resolution, frame rate, audio, scene cuts, silent stretches, speech stretches, and suggested clips with start/end seconds. Read-only and offline — it uses the ffmpeg bundled with Remotion, so the file never leaves the machine. Use it when the user sends footage and wants the key parts extracted, or asks where the cuts should go; then cut with <OffthreadVideo trimBefore> as the report describes.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Video file. Absolute, or relative to the kit directory.',
        },
        scene_threshold: {
          type: 'number',
          description: 'Frame-difference threshold for a cut, 0–1. Default 0.18; lower finds more cuts.',
        },
        silence_db: {
          type: 'number',
          description: 'Silence floor in dBFS. Default -30.',
        },
        min_clip: {
          type: 'number',
          description: 'Shortest clip worth suggesting, in seconds. Default 1.5.',
        },
        max_clips: {
          type: 'number',
          description: 'Cap on suggested clips. Default 12.',
        },
        no_scene: {
          type: 'boolean',
          description: 'Skip scene detection (much faster; audio analysis only).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs: 900000,
      async execute(args) {
        const file = resolveInputPath(String(args.path ?? '').trim())
        const report = scanVideo(file, {
          sceneThreshold: typeof args.scene_threshold === 'number' ? args.scene_threshold : undefined,
          silenceDb: typeof args.silence_db === 'number' ? args.silence_db : undefined,
          minClip: typeof args.min_clip === 'number' ? args.min_clip : undefined,
          maxClips: typeof args.max_clips === 'number' ? args.max_clips : undefined,
          noScene: args.no_scene === true,
        })
        return scanReport(report)
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'remotion_render',
      description:
        'Render a composition from the local Remotion kit to an MP4 (or a single still PNG). The render runs in a detached process, so it survives this session and does not hold the tool call open for minutes: by default the call returns a job id immediately and you poll it with remotion_renders. Pass wait: true to block until it finishes when the video is short. A first render on a fresh kit also downloads a ~130 MB headless browser.',
      parameters: {
        composition: {
          type: 'string',
          required: true,
          description: 'Composition id from remotion_list.',
        },
        format: {
          type: 'string',
          enum: ['mp4', 'still'],
          description: 'mp4 (default) or a single PNG frame.',
        },
        frame: {
          type: 'number',
          description: 'For format "still": which frame to render. Default 0.',
        },
        output: {
          type: 'string',
          description: 'Output path. Relative paths resolve inside the kit. Default out/<composition>.mp4 or out/<composition>-<frame>.png.',
        },
        concurrency: {
          type: 'number',
          description: 'Parallel browser tabs. Default: the kit\'s remotion.config.ts (4).',
        },
        wait: {
          type: 'boolean',
          description: 'Block until the render finishes. Default false.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs: 1800000,
      async execute(args, exec) {
        const kit = kitPath()
        const compositions = listCompositions()
        const composition = String(args.composition ?? '').trim()
        const known = compositions.find((entry) => entry.id === composition)
        if (known === undefined) {
          throw new Error(
            `no composition ${JSON.stringify(composition)} in the kit. Available: ${compositions.map((e) => e.id).join(', ') || '(none — create one with remotion_scaffold)'}`,
          )
        }
        const format = args.format === 'still' ? 'still' : 'mp4'
        const frame = format === 'still' ? Math.max(0, Math.floor(typeof args.frame === 'number' ? args.frame : 0)) : null
        if (format === 'still' && frame >= known.durationInFrames) {
          throw new Error(`${composition} is ${known.durationInFrames} frames long, so frame ${frame} does not exist`)
        }

        const defaultOutput = format === 'still' ? join('out', `${composition}-${frame}.png`) : join('out', `${composition}.mp4`)
        const requested = typeof args.output === 'string' && args.output.trim() !== '' ? args.output.trim() : defaultOutput
        const output = /^[A-Za-z]:[\\/]/.test(requested) || requested.startsWith('/') ? requested : join(kit, requested)

        const started = startRender({
          composition,
          format,
          frame,
          output,
          concurrency: typeof args.concurrency === 'number' ? args.concurrency : null,
        })

        if (args.wait === true) {
          const job = await waitForJob(started.jobId, DEFAULT_WAIT_TIMEOUT_MS, exec?.signal)
          return renderReport(job)
        }
        return [
          `started ${format === 'still' ? `still ${frame} of ` : ''}${composition} — job ${started.jobId}`,
          `  output: ${output}`,
          `  log: ${started.log}`,
          '',
          'It is rendering in its own process. Poll with remotion_renders {"job_id": "' + started.jobId + '"}, or keep working and check later.',
        ].join('\n')
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'remotion_renders',
      description:
        'Report render jobs: one job by id (with its log tail and the ffprobe metadata of a finished file), or the most recent renders when no id is given. Read-only. Renders are detached, so this is how a started render is checked without holding a tool call open.',
      parameters: {
        job_id: { type: 'string', description: 'The job id returned by remotion_render.' },
        log_lines: { type: 'number', description: 'How many log lines to include for a running or failed job. Default 12.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      timeoutMs: 60000,
      isConcurrencySafe: () => true,
      async execute(args) {
        const lines = typeof args.log_lines === 'number' ? Math.max(0, Math.floor(args.log_lines)) : 12
        if (typeof args.job_id === 'string' && args.job_id.trim() !== '') {
          const job = readJob(args.job_id.trim())
          const report = [renderReport(job)]
          if (job.state !== 'done' && lines > 0) {
            const tail = jobLogTail(job.id, lines)
            if (tail !== '') report.push('', 'log:', tail)
          }
          return report.join('\n')
        }
        const jobs = listJobs(JOB_LIST_LIMIT)
        if (jobs.length === 0) return 'no renders have been started from this kit yet'
        const rows = jobs.map((job) => {
          const size = job.state === 'done' ? ` · ${humanBytes(fileSize(job.output))}` : ''
          return `- ${job.id} ${job.composition} ${job.state}${size}\n    ${job.output}`
        })
        return [`${jobs.length} most recent renders:`, ...rows].join('\n')
      },
    }),
  )

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'tool:remotion',
      order: PROMPT_SECTION_ORDER,
      text:
        'The remotion_* tools make videos on this machine with Remotion. There is exactly one installed kit (a Remotion project whose src/compositions/ holds one file per video); remotion_status says where it is and whether it is healthy. List before naming a composition — remotion_list is the only truth about ids. remotion_scaffold adds a composition (blank scene, or a clone of an existing one, which is the fast path for another data video); remotion_scan_video looks inside a raw video file (scene cuts, silences, speech stretches, suggested clips) so footage can be cut by measurement instead of guesswork; remotion_render starts a render in a detached process and returns a job id, so poll remotion_renders instead of waiting inside one call. Two skills back this up: load "video-recipes" when deciding how the video should look and how long each part runs, and "remotion" before writing or editing a composition, since it documents the meta block, the registry, the timeline maths and the quirks of this installation.',
    })
  }

  const skills = ctx.get('skills')
  if (skills !== undefined) {
    skills.register(SKILL)
    skills.register(RECIPES_SKILL)
  }
}
