# Contributing to orc

Thanks for taking the time to look. Orc is small, and most changes touch only a few files, although a few conventions are worth knowing before you open a pull request.

## What lives where

| Path | What it holds |
|---|---|
| `skills/` | The eight skills. This is the only folder that gets installed into a user's repo |
| `skills/orc/status.mts` | The status script. Every rule about state lives here, along with the banners and the pointers |
| `skills/orc/hook.mts` | The permission hook, which allows only calls to `status.mts` beside it |
| `skills/orc/conventions.md` | The shared core that every command but `/orc` loads |
| `skills/orc-*/SKILL.md`, `reference.md` | One command's procedure, and its rarer branches |
| `tests/` | `status.test.ts` for the script's behaviour, `budget.test.ts` for the byte budgets, `fixture.ts` for the shared fixtures |
| `docs/` | The user docs, and `docs/spec.md` as the exhaustive reference |

[How it works](docs/how-it-works.md) explains the design behind this layout, so it is the page to read before changing the script or a skill.

## Setup

You need Node 24.3.0 or newer and `git`. There is no build step, since Node runs the TypeScript directly and `tsc` is only used to typecheck.

```
npm install
npm test
npm run typecheck
```

`npm test` takes about two minutes because most tests build real git repositories. Please run both commands before you open a pull request.

## Changing behaviour

A change in behaviour usually needs to land in three places, and they should stay in step:

1. The rule in `skills/orc/status.mts`, together with its test in `tests/status.test.ts`.
2. The skill line that acts on the verdict field the rule produces.
3. `docs/spec.md`, which stays the reference for both. If a user doc describes the behaviour, update that too.

The skills are deliberately thin. If you find yourself teaching a skill how to work out state, that logic most likely belongs in the script, where it can be tested.

## Byte budgets

What a command loads into context is bounded, and `tests/budget.test.ts` enforces it (`SKILL_BUDGETS`, `CORE_BUDGET`, `REFERENCE_BUDGET`). Treat these as guard rails against bloat and not as targets to squeeze under. A raise can be fine when you can justify it in the pull request, while size independence (a step verdict that does not grow with the registry or the roadmap) is meant to stay strict.

## Figures and logo

The images in the docs live in `docs/assets/`. Each figure has one HTML source in `docs/assets/src/`, styled by `figure.css`, and is rendered to a light and a dark PNG by a script that needs headless Chrome and ImageMagick:

```
sh docs/assets/src/render.sh
```

If you change a behaviour that a figure shows, please update its source and re-render, since an image will not show up as stale in a diff the way text does. The logo files (`logo-*.svg`, `mark-*.svg`) are plain SVG and can be edited directly.

## Commit messages

Use `<type>: <subject>`, and keep any details short, as bullet points when the commit is large.

| Type | Use it for |
|---|---|
| `feat` | a new feature |
| `fix` | a bug fix |
| `docs` | documentation changes |
| `style` | formatting only, with no change in logic |
| `refactor` | restructuring with no new feature or fix |
| `test` | adding or updating tests |
| `chore` | dependencies, build scripts, configs |
| `ci` | CI/CD configuration |
| `revert` | reverting an earlier commit |

Please do not add a `Co-Authored-By` line.

## Reporting a bug

[Open an issue](https://github.com/Siddharth-Khattar/orchestra/issues/new/choose) with the bug report form. What helps most is the banner or stop message you saw and the output of the status script, run from the root of the repo where orc is installed:

```
node .claude/skills/orc/status.mts orc --json
```

The script is read-only, so running it is always safe. Its JSON form can carry text that the normal output withholds, such as issue titles and your test command, so have a look through it and redact anything private before you paste it.

[Troubleshooting](docs/troubleshooting.md) covers the stops you are most likely to hit and lists the known limits of v1, which may save you the report.

## License

By contributing, you agree that your contribution is released under the [MIT License](LICENSE).
