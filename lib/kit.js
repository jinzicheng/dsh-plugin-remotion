/**
 * dsh-plugin-remotion — the kit.
 *
 * One Remotion installation, many videos. A "kit" is a normal Remotion project
 * that follows two conventions this plugin relies on:
 *
 *   src/compositions/*.tsx   one file per video, exporting `meta` + a component
 *   scripts/kit.mjs          `sync` regenerates src/registry.ts, `list` prints
 *                            the compositions as JSON
 *
 * Everything here is Node standard library only, and every spawn is explicit
 * about the interpreter: this machine has more than one Node on it, and the
 * host process is not necessarily the one that can run the renderer.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where this plugin's own files live (the render runner is spawned from here). */
export const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Job bookkeeping, relative to the kit. */
const JOBS_DIR = join('.remotion-plugin', 'jobs')

/** How many render jobs `remotion_renders` reports when no id is given. */
export const JOB_LIST_LIMIT = 8

/**
 * Places a kit may live, in priority order. `DSH_REMOTION_KIT` wins, so a user
 * with the kit somewhere else never has to edit this file.
 * @returns candidate absolute paths.
 */
export function kitCandidates() {
  const candidates = []
  const configured = process.env.DSH_REMOTION_KIT
  if (configured !== undefined && configured.trim() !== '') candidates.push(resolve(configured.trim()))
  candidates.push(join(homedir(), 'Desktop', '作业', 'remotion-kit'))
  candidates.push(join(homedir(), 'Desktop', 'remotion-kit'))
  candidates.push(join(homedir(), 'remotion-kit'))
  return candidates
}

/**
 * Decide whether a directory is a usable kit.
 * @param dir - candidate path.
 * @returns null when usable, otherwise the reason it is not.
 */
export function kitProblem(dir) {
  if (!existsSync(dir)) return 'does not exist'
  if (!existsSync(join(dir, 'package.json'))) return 'no package.json'
  if (!existsSync(join(dir, 'scripts', 'kit.mjs'))) return 'no scripts/kit.mjs'
  if (!existsSync(join(dir, 'node_modules', 'remotion'))) return 'node_modules/remotion is missing (run pnpm install in the kit)'
  if (!existsSync(join(dir, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'))) return 'the Remotion CLI is missing from node_modules'
  return null
}

/**
 * Find the kit, or explain every candidate that failed.
 * @returns the absolute kit path.
 */
export function kitPath() {
  const tried = []
  for (const dir of kitCandidates()) {
    const problem = kitProblem(dir)
    if (problem === null) return dir
    tried.push(`  ${dir} — ${problem}`)
  }
  throw new Error(
    `no usable Remotion kit found. Looked at:\n${tried.join('\n')}\n` +
      'Set DSH_REMOTION_KIT to the project directory, or create one with the remotion-kit layout.',
  )
}

/**
 * The Node that runs the renderer. The host process is an Electron/embedded
 * runtime on some installs, so it is the last resort rather than the default.
 * @returns the interpreter path and where it came from.
 */
export function resolveNode() {
  const configured = process.env.DSH_REMOTION_NODE
  if (configured !== undefined && configured.trim() !== '' && existsSync(configured.trim())) {
    return { path: resolve(configured.trim()), source: 'DSH_REMOTION_NODE' }
  }
  const local = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'nodejs', 'node.exe')
  if (existsSync(local)) return { path: local, source: 'user install' }
  const programFiles = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe')
  if (existsSync(programFiles)) return { path: programFiles, source: 'machine install' }
  const onPath = spawnSync('node', ['-v'], { encoding: 'utf8', windowsHide: true })
  if (onPath.status === 0) return { path: 'node', source: 'PATH' }
  return { path: process.execPath, source: 'host process (fallback)' }
}

/**
 * Run the kit's own maintenance script and return its stdout.
 * @param args - arguments after `scripts/kit.mjs`.
 * @param options - optional timeout in ms.
 * @returns trimmed stdout.
 */
export function runKit(args, options = {}) {
  const kit = kitPath()
  const node = resolveNode()
  const result = spawnSync(node.path, [join(kit, 'scripts', 'kit.mjs'), ...args], {
    cwd: kit,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs ?? 120000,
  })
  if (result.error !== undefined && result.error !== null) {
    throw new Error(`could not run scripts/kit.mjs with ${node.path}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
    throw new Error(`scripts/kit.mjs ${args.join(' ')} failed (exit ${result.status}):\n${detail}`)
  }
  return (result.stdout ?? '').trim()
}

/**
 * The compositions the kit knows about.
 * @returns the parsed `list` output.
 */
export function listCompositions() {
  const raw = runKit(['list'])
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`scripts/kit.mjs list did not return JSON: ${error.message}\n${raw.slice(0, 400)}`)
  }
}

/**
 * Regenerate src/registry.ts from src/compositions/.
 * @returns the script's own one-line report.
 */
export function syncRegistry() {
  return runKit(['sync'])
}

/**
 * The installed Remotion version, read from the kit rather than assumed.
 * @returns the version string, or null when unreadable.
 */
export function remotionVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(kitPath(), 'node_modules', 'remotion', 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/**
 * The headless browser Remotion renders with. Its absence is why a first render
 * downloads ~130 MB, so it is worth reporting.
 * @returns the path when present, otherwise null.
 */
export function chromeShellPath() {
  const shell = join(kitPath(), 'node_modules', '.remotion', 'chrome-headless-shell')
  return existsSync(shell) ? shell : null
}

/**
 * Where renders write their intermediate files. Windows temp is not always
 * writable for a sandboxed caller, so the kit keeps its own.
 * @returns the absolute temp directory.
 */
export function kitTempDir() {
  const dir = join(kitPath(), '.tmp')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * A sortable, unique job id.
 * @returns e.g. `20261111-213600-a1b2`.
 */
function newJobId() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${stamp}-${suffix}`
}

/**
 * The job directory for the current kit.
 * @returns the absolute path, created if needed.
 */
export function jobsDir() {
  const dir = join(kitPath(), JOBS_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Read one job record.
 * @param jobId - the id returned by startRender.
 * @returns the parsed record plus liveness.
 */
export function readJob(jobId) {
  const file = join(jobsDir(), `${jobId}.json`)
  if (!existsSync(file)) throw new Error(`no render job ${jobId}`)
  const job = JSON.parse(readFileSync(file, 'utf8'))
  return { ...job, ...liveness(job) }
}

/**
 * Decide whether a running job still has a live process behind it. A render that
 * outlives the session that started it is fine; one whose process vanished is
 * not, and saying so is better than reporting "running" forever.
 * @param job - the job record.
 * @returns `{state, note}`.
 */
function liveness(job) {
  if (job.status !== 'running' || typeof job.pid !== 'number') return { state: job.status, note: '' }
  try {
    process.kill(job.pid, 0)
    return { state: 'running', note: '' }
  } catch {
    return { state: 'interrupted', note: 'the render process is gone without writing a result' }
  }
}

/**
 * The most recent jobs, newest first.
 * @param limit - how many to return.
 * @returns job records.
 */
export function listJobs(limit = JOB_LIST_LIMIT) {
  const dir = jobsDir()
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
  return files.map((name) => {
    const job = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    return { ...job, ...liveness(job) }
  })
}

/**
 * Start a render and return immediately.
 *
 * The work runs in a detached child so a five-minute render is not a five-minute
 * tool call, and so it survives the session that asked for it. Progress lands in
 * a log file and the result in the job record.
 * @param options - composition, format, frame, output, concurrency.
 * @returns the job id and the paths worth reporting.
 */
export function startRender(options) {
  const kit = kitPath()
  const node = resolveNode()
  const jobId = newJobId()
  const dir = jobsDir()
  const jobFile = join(dir, `${jobId}.json`)

  const job = {
    id: jobId,
    composition: options.composition,
    format: options.format,
    frame: options.frame ?? null,
    output: options.output,
    concurrency: options.concurrency ?? null,
    kit,
    node: node.path,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    durationMs: null,
    sizeBytes: null,
    probe: null,
    error: null,
    pid: null,
    log: `${jobFile.replace(/\.json$/, '')}.log`,
  }
  writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8')

  const child = spawn(node.path, [join(PLUGIN_ROOT, 'lib', 'run-render.mjs'), jobFile], {
    cwd: kit,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, CI: 'true', TEMP: kitTempDir(), TMP: kitTempDir() },
  })
  child.unref()

  // The runner records its own pid; this is only a hint until it does.
  job.pid = child.pid ?? null
  writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8')

  return { jobId, jobFile, log: job.log, output: options.output }
}

/**
 * Read the tail of a job's log — the only window into a running render.
 * @param jobId - the job.
 * @param lines - how many lines to return.
 * @returns the tail, or '' when there is no log yet.
 */
export function jobLogTail(jobId, lines = 20) {
  const file = join(jobsDir(), `${jobId}.log`)
  if (!existsSync(file)) return ''
  const text = readFileSync(file, 'utf8')
  return text.split(/\r?\n/).filter((line) => line !== '').slice(-lines).join('\n')
}

/**
 * File size in bytes, or null.
 * @param file - path.
 * @returns the size.
 */
export function fileSize(file) {
  try {
    return statSync(file).size
  } catch {
    return null
  }
}

/**
 * Analyse a video with the kit's own scanner: probe, scene cuts, silences,
 * speech stretches, suggested clips.
 *
 * The work happens in `scripts/scan-video.mjs` rather than here because the
 * scanner is useful on its own (`node scripts/scan-video.mjs clip.mp4`) and
 * because it needs a full Node — the host process may not be one.
 * @param file - the video to look at.
 * @param options - thresholds, all optional.
 * @returns the parsed report.
 */
export function scanVideo(file, options = {}) {
  const kit = kitPath()
  const node = resolveNode()
  const scanner = join(kit, 'scripts', 'scan-video.mjs')
  if (!existsSync(scanner)) {
    throw new Error(`the kit has no scripts/scan-video.mjs — it is part of the kit, not the plugin: ${scanner}`)
  }
  if (!existsSync(file)) throw new Error(`no such file: ${file}`)

  const args = [scanner, resolve(file)]
  if (typeof options.sceneThreshold === 'number') args.push(`--scene=${options.sceneThreshold}`)
  if (typeof options.silenceDb === 'number') args.push(`--silence-db=${options.silenceDb}`)
  if (typeof options.silenceMin === 'number') args.push(`--silence-min=${options.silenceMin}`)
  if (typeof options.minClip === 'number') args.push(`--min-clip=${options.minClip}`)
  if (typeof options.maxClips === 'number') args.push(`--max-clips=${options.maxClips}`)
  if (options.noScene === true) args.push('--no-scene')

  const result = spawnSync(node.path, args, {
    cwd: kit,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? 600000,
  })
  if (result.error !== undefined && result.error !== null) {
    throw new Error(`could not run scripts/scan-video.mjs with ${node.path}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
    throw new Error(`scanning ${file} failed (exit ${result.status}):\n${detail}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`scripts/scan-video.mjs did not return JSON: ${error.message}`)
  }
}

