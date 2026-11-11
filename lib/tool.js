/**
 * dsh-plugin-remotion — a dependency-free `defineTool` equivalent.
 *
 * The official helper lives in `@deepseek-ai/dsh-tools`, which is only
 * resolvable from inside a booted profile. A plugin that is installed by path
 * must keep loading regardless of hoisting layout or host version, so this
 * reproduces the exact registry-ready shape using plain JavaScript:
 *
 *   {
 *     name, description,
 *     parameters: <raw JSON Schema, object-rooted>,
 *     output: { schema: <raw JSON Schema>, render(args, value): ContentBlock[] },
 *     timeoutMs?,
 *     execute(args, exec): Promise<canonicalValue>,
 *     isConcurrencySafe?(args): boolean,
 *   }
 */

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

/**
 * Convert one author-facing value schema node into a raw JSON Schema node.
 * @param spec - the author-facing node.
 * @param path - property path, for error messages.
 * @returns an equivalent raw JSON Schema node.
 */
function toJsonSchema(spec, path) {
  if (spec === null || typeof spec !== 'object') {
    throw new Error(`invalid schema at ${path}: expected an object`)
  }
  const out = {}
  if (typeof spec.description === 'string') out.description = spec.description
  if (Array.isArray(spec.enum)) out.enum = [...spec.enum]

  const type = spec.type
  if (type === 'json') return out
  if (SCALAR_TYPES.has(type)) {
    out.type = type
    return out
  }
  if (type === 'array') {
    out.type = 'array'
    if (spec.items !== undefined) out.items = toJsonSchema(spec.items, `${path}[]`)
    return out
  }
  if (type === 'object') {
    out.type = 'object'
    const compiled = toPropertyMap(spec.properties ?? {}, path)
    out.properties = compiled.properties
    if (compiled.required !== undefined) out.required = compiled.required
    out.additionalProperties = spec.additionalProperties ?? false
    return out
  }
  throw new Error(`invalid schema at ${path}: unsupported type ${JSON.stringify(type)}`)
}

/**
 * Convert an author-facing property map into raw JSON Schema `properties` plus
 * the sibling `required` array.
 * @param spec - per-property author-facing nodes.
 * @param path - parent path, for error messages.
 * @returns the compiled properties and required list.
 */
function toPropertyMap(spec, path) {
  const properties = {}
  const required = []
  for (const key of Object.keys(spec)) {
    const node = spec[key] ?? {}
    const { required: isRequired, ...authorNode } = node
    properties[key] = toJsonSchema(authorNode, `${path}.${key}`)
    if (isRequired === true) required.push(key)
  }
  return required.length > 0 ? { properties, required } : { properties }
}

/**
 * Report the first batch of argument violations against an author-facing spec.
 * @param spec - the author-facing parameter spec.
 * @param args - candidate arguments.
 * @returns path-qualified violations; empty means valid.
 */
function validate(spec, args) {
  const violations = []
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return ['<root>: expected an object']
  }
  for (const key of Object.keys(spec)) {
    const node = spec[key] ?? {}
    const value = args[key]
    if (value === undefined || value === null) {
      if (node.required === true) violations.push(`${key}: required`)
      continue
    }
    if (node.type === 'string' && typeof value !== 'string') violations.push(`${key}: expected a string`)
    else if ((node.type === 'number' || node.type === 'integer') && typeof value !== 'number') violations.push(`${key}: expected a number`)
    else if (node.type === 'boolean' && typeof value !== 'boolean') violations.push(`${key}: expected a boolean`)
    else if (node.type === 'array' && !Array.isArray(value)) violations.push(`${key}: expected an array`)
    if (Array.isArray(node.enum) && !node.enum.includes(value)) {
      violations.push(`${key}: expected one of ${node.enum.map((v) => JSON.stringify(v)).join(', ')}`)
    }
    if (node.type === 'array' && Array.isArray(value) && node.items?.type === 'string') {
      value.forEach((item, index) => {
        if (typeof item !== 'string') violations.push(`${key}[${index}]: expected a string`)
      })
    }
  }
  return violations
}

/**
 * Build a registry-ready tool definition.
 * @param options - name, description, author-facing parameters, output contract, execute.
 * @returns the definition `ctx.tools.register` accepts.
 */
export function defineTool(options) {
  const { name, description, parameters, output, timeoutMs, isConcurrencySafe, execute } = options
  if (typeof name !== 'string' || name.length === 0) throw new Error('defineTool: name is required')
  if (typeof execute !== 'function') throw new Error(`defineTool(${name}): execute is required`)
  if (output === undefined || typeof output.render !== 'function') {
    throw new Error(`defineTool(${name}): output.render is required`)
  }
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error(`defineTool(${name}): timeoutMs must be a positive finite number`)
  }

  const compiled = toPropertyMap(parameters ?? {}, 'parameters')
  const tool = {
    name,
    description,
    parameters: { type: 'object', properties: compiled.properties, ...(compiled.required ? { required: compiled.required } : {}) },
    output: {
      schema: toJsonSchema(output.schema, 'output.schema'),
      render: (args, value) => output.render(args, value),
    },
    async execute(args, exec) {
      const violations = validate(parameters ?? {}, args)
      if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join('; ')}`)
      return execute(args, exec)
    },
  }
  if (timeoutMs !== undefined) tool.timeoutMs = timeoutMs
  if (isConcurrencySafe !== undefined) tool.isConcurrencySafe = (args) => isConcurrencySafe(args)
  return tool
}
