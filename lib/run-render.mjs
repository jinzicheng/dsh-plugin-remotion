#!/usr/bin/env node
/**
 * dsh-plugin-remotion — one detached render.
 *
 * Spawned by `startRender` with the path of a job record. It runs the kit's own
 * Remotion CLI, mirrors everything it prints into `<job>.log`, and writes the
 * outcome back into the job record so `remotion_renders` can report it long
 * after the session that started the render is gone.
 *
 * Kept deliberately free of plugin imports: it must run under any Node, from any
 * working directory, with no dependency resolution beyond this file.
 */
import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, readdirSync, writeFileSync, closeSync } from 'node:fs'
import { join } from 'node:path'

const jobFile = process.argv[2]
if (!jobFile) {
  console.error('usage: node run-render.mjs <job.json>')
  process.exit(2)
}

/** Write the job record back, merging the given fields. */
function update(fields) {
  const current = JSON.parse(readFileSync(jobFile, 'utf8'))
  writeFileSync(jobFile, JSON.stringify({ ...current, ...fields }, null, 2), 'utf8')
}

/**
 * ffprobe ships inside the Remotion compositor package, whose directory name is
 * platform-specific, so it is discovered rather than assumed.
 * @param kit - the kit directory.
 * @returns the ffprobe path, or null.
 */
function findFfprobe(kit) {
  const scoped = join(kit, 'node_modules', '@remotion')
  if (!existsSync(scoped)) return null
  for (const name of readdirSync(scoped)) {
    if (!name.startsWith('compositor')) continue
    const candidate = join(scoped, name, 'ffprobe.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Read duration, size, dimensions and frame count out of a finished file.
 * @param kit - the kit directory.
 * @param file - the rendered file.
 * @returns a small metadata object, or null when ffprobe is unavailable.
 */
function probe(kit, file) {
  const ffprobe = findFfprobe(kit)
  if (ffprobe === null) return null
  return new Promise((resolve) => {
    const child = spawn(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames',
        '-of', 'json',
        file,
      ],
      { windowsHide: true },
    )
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out)
        const stream = (parsed.streams ?? [])[0] ?? {}
        resolve({
          durationSeconds: parsed.format?.duration !== undefined ? Number(Number(parsed.format.duration).toFixed(2)) : null,
          codec: stream.codec_name ?? null,
          width: stream.width ?? null,
          height: stream.height ?? null,
          fps: stream.r_frame_rate ?? null,
          frames: stream.nb_frames !== undefined ? Number(stream.nb_frames) : null,
        })
      } catch {
        resolve(null)
      }
    })
  })
}

const job = JSON.parse(readFileSync(jobFile, 'utf8'))
const { kit, composition, format, frame, output, concurrency } = job
const cli = join(kit, 'node_modules', '@remotion', 'cli', 'remotion-cli.js')
const started = Date.now()

if (!existsSync(cli)) {
  update({ status: 'failed', finishedAt: new Date().toISOString(), error: `Remotion CLI not found at ${cli}` })
  process.exit(1)
}

const args = [cli]
if (format === 'still') {
  args.push('still', composition, output, `--frame=${frame ?? 0}`, '--log=info')
} else {
  args.push('render', composition, output, '--log=info')
  if (typeof concurrency === 'number') args.push(`--concurrency=${concurrency}`)
}

const logFd = openSync(job.log, 'a')
const child = spawn(process.execPath, args, {
  cwd: kit,
  env: { ...process.env, CI: 'true' },
  windowsHide: true,
  stdio: ['ignore', logFd, logFd],
})

update({ pid: child.pid ?? null, runnerPid: process.pid })

child.on('error', (error) => {
  try { closeSync(logFd) } catch {}
  update({
    status: 'failed',
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    error: error.message,
  })
  process.exit(1)
})

child.on('close', async (code) => {
  try { closeSync(logFd) } catch {}
  const durationMs = Date.now() - started
  const finishedAt = new Date().toISOString()
  if (code !== 0) {
    const tail = (() => {
      try {
        return readFileSync(job.log, 'utf8').split(/\r?\n/).filter(Boolean).slice(-12).join('\n')
      } catch {
        return ''
      }
    })()
    update({ status: 'failed', finishedAt, durationMs, exitCode: code, error: tail || `exit ${code}` })
    process.exit(1)
  }
  let sizeBytes = null
  try {
    sizeBytes = (await import('node:fs')).statSync(output).size
  } catch {
    sizeBytes = null
  }
  const details = format === 'still' ? null : await probe(kit, output)
  update({ status: 'done', finishedAt, durationMs, exitCode: 0, sizeBytes, probe: details })
})
