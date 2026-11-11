/**
 * dsh-plugin-remotion — the starting point a new composition gets.
 *
 * A template is plain text with placeholders replaced by `scaffold`, so the
 * generated file is ordinary code the user owns from the first save: nothing
 * here is re-applied later, and nothing has to be kept in sync with this plugin.
 */

/**
 * Render the blank scene template.
 *
 * Deliberately one self-contained file: a background, a title that eases in, a
 * subtitle, and a progress bar — the three things every video in this kit has —
 * with a comment on each animation so the next edit is obvious.
 * @param options - id, title, subtitle, fps, width, height, durationInFrames.
 * @returns the TypeScript source.
 */
export function sceneTemplate(options) {
  const { id, title, subtitle, fps, width, height, durationInFrames } = options
  return `import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/**
 * Read statically by scripts/kit.mjs to build src/registry.ts, so every value
 * must be a literal. Changing them here changes the composition's shape.
 */
export const meta = {
  id: '${id}',
  title: ${JSON.stringify(title)},
  fps: ${fps},
  width: ${width},
  height: ${height},
  durationInFrames: ${durationInFrames},
} as const;

const FONT =
  '"Microsoft YaHei", "Noto Sans SC", "PingFang SC", "Segoe UI", system-ui, sans-serif';

export const ${id}: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  // Ease the block in over the first 24 frames, then let it drift slowly.
  const appear = interpolate(frame, [0, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const drift = interpolate(frame, [0, durationInFrames], [0, -16], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(1100px 700px at 75% 20%, rgba(76,141,255,0.18), transparent 60%),' +
          'linear-gradient(160deg, #05070F 0%, #0A1020 55%, #0C1730 100%)',
        fontFamily: FONT,
        color: '#E9EEF8',
      }}
    >
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: appear,
          transform: \`translateY(\${(1 - appear) * 24 + drift}px)\`,
        }}
      >
        <div style={{fontSize: 88, fontWeight: 800, letterSpacing: 2, textAlign: 'center'}}>
          ${escapeJsxText(title)}
        </div>
        <div style={{fontSize: 30, color: '#7D8FB0', marginTop: 22, textAlign: 'center'}}>
          ${escapeJsxText(subtitle)}
        </div>
      </AbsoluteFill>

      {/* Progress bar — replace with a real timeline when the video has parts. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 6,
          width: \`\${(frame / (durationInFrames - 1)) * 100}%\`,
          background: 'linear-gradient(90deg, #4C8DFF, #22D3A6)',
        }}
      />
    </AbsoluteFill>
  );
};
`
}

/**
 * Make text safe to drop inside JSX, where `{`, `}` and `<` would be syntax.
 * @param text - the raw text.
 * @returns JSX-safe text.
 */
function escapeJsxText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

/**
 * Rewrite a cloned composition: new id, new title, optionally new timing.
 *
 * Only the `meta` block and the component's export name are touched, because
 * everything else in the file is the user's own code and is being copied
 * verbatim on purpose.
 * @param source - the composition file being cloned.
 * @param options - id, title, and optional fps/width/height/durationInFrames.
 * @param from - the source id, for renaming the exported component.
 * @returns the rewritten source.
 */
export function renameComposition(source, options, from) {
  const { id, title, fps, width, height, durationInFrames } = options
  const start = source.indexOf('export const meta')
  if (start < 0) throw new Error('the source composition has no "export const meta" block to rewrite')
  const open = source.indexOf('{', start)
  let depth = 1
  let quote = null
  let end = -1
  for (let i = open + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (quote !== null) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error('the source composition meta block is never closed')

  let meta = source.slice(open + 1, end)
  const setField = (field, value) => {
    const pattern = new RegExp(`(${field}\\s*:\\s*)(?:'[^']*'|"[^"]*"|-?\\d+(?:\\.\\d+)?)`)
    if (!pattern.test(meta)) throw new Error(`the source composition meta has no ${field} field`)
    meta = meta.replace(pattern, `$1${value}`)
  }
  setField('id', `'${id}'`)
  setField('title', JSON.stringify(title))
  if (fps !== undefined) setField('fps', String(fps))
  if (width !== undefined) setField('width', String(width))
  if (height !== undefined) setField('height', String(height))
  if (durationInFrames !== undefined) setField('durationInFrames', String(durationInFrames))

  let next = source.slice(0, open + 1) + meta + source.slice(end)
  const exportPattern = new RegExp(`export\\s+const\\s+${from}\\s*:`)
  if (exportPattern.test(next)) {
    next = next.replace(exportPattern, `export const ${id}:`)
  } else {
    throw new Error(`the source composition does not export a component named ${from}`)
  }
  return next
}
