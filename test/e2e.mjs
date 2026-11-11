#!/usr/bin/env node
/**
 * dsh-plugin-remotion — end-to-end check without a booted harness.
 *
 * Builds the smallest possible plugin context, registers the tools exactly the
 * way the host does, and then drives them: status, list, scaffold, a still
 * render, and the job report. Exits non-zero on the first real disagreement.
 *
 *   node test/e2e.mjs            status, list, renders (read-only)
 *   node test/e2e.mjs --write    also scaffold a composition and render a still
 */
import { existsSync, statSync } from 'node:fs'

import { apply } from '../lib/index.js'

const WRITE = process.argv.includes('--write')
const tools = new Map()
const skills = []
const promptSections = []

const ctx = {
  tools: {
    register(tool) {
      if (tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`)
      tools.set(tool.name, tool)
    },
  },
  get(service) {
    if (service === 'systemPrompt') {
      return { section: (section) => promptSections.push(section) }
    }
    if (service === 'skills') {
      return { register: (skill) => skills.push(skill) }
    }
    return undefined
  },
}

apply(ctx)

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** Call a registered tool the way the executor would. */
async function call(name, args = {}) {
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(`tool ${name} was never registered`)
  const controller = new AbortController()
  return tool.execute(args, { signal: controller.signal })
}

console.log('registration')
check('five tools registered', tools.size === 5, [...tools.keys()].join(', '))
check('skill registered', skills.length === 1 && skills[0].name === 'remotion')
check('prompt section registered', promptSections.length === 1)
check(
  'every tool declares parameters and output',
  [...tools.values()].every((t) => t.parameters?.type === 'object' && typeof t.output?.render === 'function'),
)

console.log('\nremotion_status')
const status = await call('remotion_status')
console.log(status.split('\n').map((l) => `  | ${l}`).join('\n'))
check('status names the kit', /^kit: .+remotion-kit/m.test(status))
check('status names a node', /^node: .+/m.test(status))

console.log('\nremotion_list')
const list = await call('remotion_list')
console.log(list.split('\n').map((l) => `  | ${l}`).join('\n'))
check('list names BirthRate', list.includes('BirthRate'))

console.log('\nremotion_renders')
const renders = await call('remotion_renders')
check('renders answers', typeof renders === 'string' && renders.length > 0)

if (WRITE) {
  const id = 'E2eCheck'
  const compositionFile = `C:/Users/Lenovo/Desktop/作业/remotion-kit/src/compositions/${id}.tsx`
  console.log(`\nremotion_scaffold ${id}`)
  if (existsSync(compositionFile)) {
    // Left over from an interrupted run: drop the file so the scaffold below is
    // the thing under test. The scaffold's own sync rebuilds the registry from
    // the directory, so the stale registry entry disappears with it.
    const { unlinkSync } = await import('node:fs')
    unlinkSync(compositionFile)
  }
  const scaffolded = await call('remotion_scaffold', {
    id,
    title: 'Remotion 插件自检',
    subtitle: '一个空场景模板，改它就行',
    duration_in_frames: 150,
  })
  console.log(scaffolded.split('\n').map((l) => `  | ${l}`).join('\n'))
  check('scaffold reports the file', scaffolded.includes(`src/compositions/${id}.tsx`))

  const after = await call('remotion_list')
  check('list now includes the new composition', after.includes(id))

  console.log('\nremotion_render (still)')
  const started = await call('remotion_render', { composition: id, format: 'still', frame: 40, wait: true })
  console.log(started.split('\n').map((l) => `  | ${l}`).join('\n'))
  check('still rendered', /rendered .* → .*\.png/.test(started))

  const jobId = (started.match(/job (\S+)/) ?? [])[1]
  const output = (started.match(/→ (.+\.png)/) ?? [])[1]
  check('output file exists', output !== undefined && existsSync(output), String(output))
  if (output !== undefined && existsSync(output)) {
    check('output is non-trivial', statSync(output).size > 20000, `${statSync(output).size} bytes`)
  }

  const job = await call('remotion_renders', { job_id: jobId })
  check('job report resolves', job.includes(jobId))

  // Leave the kit as it was found: the test composition is not a deliverable.
  const { unlinkSync } = await import('node:fs')
  unlinkSync(compositionFile)
  const { syncRegistry } = await import('../lib/kit.js')
  syncRegistry()
  const finalList = await call('remotion_list')
  check('test composition removed again', !finalList.includes(`${id} —`))
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
