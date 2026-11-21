The caller wants the project's tests, linter or type checker run and the result reported, or wants
lint findings fixed.

1. `await scripts.run("checks")` runs pytest, ruff, mypy and pyright where the project declares,
   configures or has installed them, and lists what it skipped and why. Narrow with `only` (a file
   or folder), `k` (a pytest `-k` expression) or `tools`.
2. A failing test: the answer gives the node id, `file:line`, and the assertion lines (`assertion`,
   or `message`). For one test's whole traceback: `await py.pytest({ path: "<node id>", full: true })`.
   A failure whose message is `ModuleNotFoundError` is an environment problem: continue with
   `await scripts.run("why-fails", { module: "<name>" })`.
3. Lint: group the answer by rule code (`byCode`), give the three most frequent with one
   `file:line` each, and say how many are fixable. `fixable: "safe"` fixes change no behaviour;
   `"unsafe"` ones can.
4. Types: the same, by error code, with the `file:line` of the first of each.
5. To fix lint (the request says fix, format or clean up): `skills.read("fix-lint")`, apply it, run
   `checks` again and report the before and after counts.
6. Fixing a failing test or a type error means editing source code. You have no editor: say what
   the failure is and where, and that changing the code is for the calling session (or the `code`
   kit).

Never report a check as passing that was skipped. A tool that is not installed in the virtualenv is
reported as not run.
