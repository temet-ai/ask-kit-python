# ask-kit-python

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about a Python project and its environment: which Python and which virtualenv it
uses and why, whether `uv sync` is up to date with the lock, why an import or `uv run` fails, what
`pyproject.toml` declares, and what pytest, ruff, mypy and pyright say. A cheap model runs `uv`
and the project's own tools outside your agent's context and answers with node ids, `file:line`,
rule codes and the file and key that set a value.

Questions from its bench, of the kinds agents answer by hand with `uv` and `pytest`:

- Which Python does the project pin, and does the pin agree with requires-python?
- Why does `uv run semaphore` say the command is not found?
- Which locked packages have no wheel for Python 3.14 and would build from source?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) and `python3` (3.11 or newer,
for `tomllib`). The kit uses `uv`, `pytest`, `ruff`, `mypy` and `pyright` when the project has
them; the checks that need one that is missing are reported as not run.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-python
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-python        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-python --yes  # installs and enables it
```

Restart your agents so `ask` lists `python`. The kit answers about the project your agent works in;
a question that names another folder is answered there. One setting, `PY_CHECK_TIMEOUT_SECONDS`
(default 300), limits how long one pytest, ruff, mypy or pyright run may take.

## What it carries

| | |
|---|---|
| Scripts | `env` (which Python and virtualenv, why, and what is wrong with the setup), `sync` (lock against `pyproject.toml`, virtualenv against lock), `why-fails` (an import or a command that cannot be found), `wheels` (packages with no wheel for this Python, also for another version), `project` (what `pyproject.toml` declares), `checks` (pytest, ruff, mypy and pyright, summarised) |
| Skills | `add-remove`, `pin-python`, `fix-lint`, `source-build`: playbooks the investigator loads when the job calls for one |
| Roles | `environment-doctor` for failing imports, `uv run` and installs; `checker` for running and fixing checks |

Each script also runs with no model: `ask-kit run python env`, or `ask(do: "python.env")` from an
agent. The scripts take `path` for another project folder.

## What it can change

When the request asks for a change, it runs `uv sync`, `lock`, `add`, `remove` and `venv`, installs
and pins Python versions with `uv python`, applies `ruff check --fix` and `ruff format`, and edits
the project's config files (`pyproject.toml`, `ruff.toml`, `mypy.ini`, `pytest.ini`, `.python-version`
and a few others) one exact replacement at a time. A question never changes anything: `python.mjs`
sorts every call into reading or changing, and a changing call is refused unless the caller asked
for a change (`act`).

`python.mjs` also checks each command before it runs:

- Only `uv`, `ruff`, `mypy`, `pyright`, `pytest`, `pip` and `python` run, without a shell. `pytest`,
  `mypy`, `pyright` and `pip` come from the project's virtualenv, because they import the project's
  packages.
- What publishes or logs in is refused (`uv publish`, `uv auth`, `--token`), and so is what never
  ends or waits for a person (`--watch`, `--pdb`, `ruff server`, `mypy --daemon`). URL passwords
  and tokens in output are masked. What the investigator reads goes to a model.
- The check runs write no cache or report into the project. They do run the project's own code:
  pytest imports and runs the tests, and mypy and pyright read the source. A test that writes files
  writes them.

Its instructions tell it never to upgrade packages, apply unsafe ruff fixes or add `noqa` comments
unless the request asks for that outcome, and never to edit `uv.lock` by hand.

## How well it works

`bench/questions.json` holds nine questions and two script runs (run `bench/make-fixture.sh` first
to build the virtualenvs they ask about), each with patterns its answer must hold. It has not been
run on a model yet; `ask-kit kit test python` runs it.
