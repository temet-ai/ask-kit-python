# Recipe: python kit

## What it answers

A Python project and its environment as it is now: which interpreter and virtualenv it uses and
why, whether the virtualenv matches `uv.lock` and the lock matches `pyproject.toml`, why an import
or a command fails, which locked packages have no wheel for this Python, what `pyproject.toml`
declares, and what pytest, ruff, mypy and pyright report. It changes things when asked: `uv sync`,
`lock`, `add`, `remove`, `python pin`, `ruff check --fix`, `ruff format`, and small edits of config
files.

## What it needs

- `python3` 3.11 or newer on PATH (it reads TOML with `tomllib`).
- `uv` for the lock and sync questions and for acting. Without it `env` and `project` still work.
- `pytest`, `ruff`, `mypy` and `pyright` in the project's virtualenv (ruff also from PATH) for the
  checks. A missing one is reported as not run.
- No keys. `uv` uses whatever index credentials the user has configured; output is masked.

## What it reads and runs

- Runs `uv`, `ruff`, `mypy`, `pyright`, `pytest`, `pip` and `python` (no shell) through `python.mjs`
  in the project folder the calling agent works in, or in a folder the question names (`py.at(path)`).
- Reads `pyproject.toml`, `uv.lock`, `.python-version`, `.tool-versions`, `mise.toml`,
  `ruff.toml` and the virtualenv's `pyvenv.cfg`. Tests, ruff, mypy and pyright run the project's
  own code and read its source.
- Refuses a call that changes things unless the ask may act; refuses publishing, login and
  never-ending modes; masks URL passwords and tokens.

## Rebuild it from an empty folder

Write `ask-kit.toml` with one `module` source named `py`, a `PY_CHECK_TIMEOUT_SECONDS` setting
(default 300) and `acts` written as prose (the host cannot tell `uv sync --dry-run` from `uv sync`,
so the module does the holding back). The module exports `make({settings, push, cwd, act})`
returning a client with `run(program, ...args)` and `text(...)` (every call classified as reading
or changing; changing throws without `act`), `at(dir)`, `root()`, `toml(file)`, `venv()`,
`installed()`, `pins()`, `project()`, `lock()`, `target()`, `wheelFits()`, `satisfies()`,
`toolchain()`, `tryImport(module)`, `pytest(o)`, `ruff(o)`, `mypy(o)`, `pyright(o)` and `edit(file,
find, replace)`. TOML is read by `python3 -I` with `tomllib`, and `uv.lock` is reduced to names,
versions and wheel file names in the same call. `pytest` runs with `--junitxml` into a temporary
folder and `-p no:cacheprovider`; ruff with `--output-format=json --no-cache`; mypy with
`--cache-dir=/dev/null`; pyright with `--outputjson`. Run `uv` read calls with
`UV_PYTHON_DOWNLOADS=manual` so a question never downloads an interpreter. Describe it exactly in
`api.d.ts`.

Scripts: `env`, `sync` (`uv lock --check --offline`, then `uv sync --dry-run --frozen --offline`;
when the lock cannot be checked offline it compares the declared names with what the lock recorded),
`why-fails`, `wheels` (the PEP 425 tag rules against the lock's wheel file names), `project`,
`checks`.

Skills in `skills/`: add-remove, pin-python, fix-lint, source-build. Roles in `roles/`:
environment-doctor, checker. `instructions.md`: start from a script, run tools from the project's
virtualenv, say whether a package is missing from `pyproject.toml`, the lock or the virtualenv, act
only as wide as the request.

## Bench

`bench/questions.json`: nine questions of the kinds agents answer by hand about a Python project,
put to the two projects in `bench/fixtures` (`clacks`, `overseer`) whose virtualenvs
`bench/make-fixture.sh` builds, and two script runs.
