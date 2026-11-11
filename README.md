# dsh-plugin-remotion

Turn this machine into a **Remotion video workshop** and let the agent drive it.

One Remotion installation (the *kit*), many videos. Ask for a video, the agent
lists what exists, scaffolds a new composition, renders it to MP4, and polls the
job until the file is on disk.

## Tools

| tool | what it does |
| --- | --- |
| `remotion_status` | kit path, which Node renders, Remotion version, headless browser, every composition |
| `remotion_list` | compositions with size, fps, length and source file |
| `remotion_scaffold` | add a composition — blank scene, or a clone of an existing one |
| `remotion_render` | render to MP4 or a single still, in a detached process |
| `remotion_renders` | poll a render job, or list recent ones |

Plus a `remotion` **skill** with the authoring knowledge: the composition
contract, timeline maths, data-video patterns, and the quirks of this
installation.

## The kit

The plugin does not create projects; it works on the one kit it finds:

```
remotion-kit/
  src/compositions/<Id>.tsx   one video per file, exports `meta` + component
  src/registry.ts             generated — never edited by hand
  src/Root.tsx                maps the registry onto <Composition>
  scripts/kit.mjs             `sync` | `list` | `check`
  public/                     data and assets
  out/                        renders
  .remotion-plugin/jobs/      job records and logs
```

A directory qualifies when it has `package.json`, `scripts/kit.mjs`,
`node_modules/remotion` and `node_modules/@remotion/cli`.

## Configuration

| variable | default |
| --- | --- |
| `DSH_REMOTION_KIT` | `%USERPROFILE%\Desktop\作业\remotion-kit`, then `%USERPROFILE%\remotion-kit` |
| `DSH_REMOTION_NODE` | `%LOCALAPPDATA%\nodejs\node.exe`, then `%ProgramFiles%\nodejs\node.exe`, then `node` on PATH |

## Install

From GitHub (any machine):

```
dsh plugin --profile desktop add github:jinzicheng/dsh-plugin-remotion
```

From a local checkout (what this machine uses while developing):

```
dsh plugin --profile desktop add file:C:\Users\Lenovo\dsh-plugins\dsh-plugin-remotion
```

or through the plugin manager with the same spec. Restart the app (or open a new
session) for the tool row to appear.

## Updating

The profile installs a copy, not a link: after changing `lib/`, reinstall the
same spec (`plugin_manager` install_bundle, or the command above) and open a new
session. `lib/skill.md` is read at load time, so it follows the same rule.


## Test

```
node test/e2e.mjs           # status, list, renders — read-only
node test/e2e.mjs --write   # also scaffolds `Demo` and renders one still
```

The test builds a stub plugin context and registers the tools exactly the way the
host does, so it fails for real reasons rather than for missing services.

## Notes

- Renders are detached on purpose: a 38 s 1080p video takes ~5 minutes, which is
  too long to hold a tool call open, and the render should survive the session
  that asked for it.
- The runner writes `TEMP`/`TMP` into the kit's `.tmp`, because the Windows temp
  directory is not writable for every caller and ffmpeg fails there first.
- No dependencies outside Node's standard library, so it loads regardless of the
  profile's hoisting layout.
