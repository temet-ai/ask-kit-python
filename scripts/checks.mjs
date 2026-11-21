export const meta = {
  purpose:
    "Runs the project's own Python checks in its virtualenv and summarises each: pytest (counts, each failing test with file:line and the assertion), ruff (violations by code, files format would change), mypy and pyright (errors with file:line and code). It runs the tools the project declares or configures and says why it skipped the others (not installed in the venv, not configured). Changes nothing.",
  params: { path: "another project folder, optional", tools: "an array of pytest, ruff, mypy, pyright to run, optional (default: those the project declares, configures or has installed in its virtualenv)", only: "a file or folder to check, optional; for pytest a test file or node id", k: "a pytest -k expression, optional", max: "failures or violations listed per tool, default 10" },
  returns: "{root, venv:{exists, version}, ran:[{tool, code, counts, failures|violations|errors|diagnostics}], skipped:[{tool, reason}], ok: true|false, headline}",
  example: 'await scripts.run("checks")',
};

export default async function ({ py }, { path, tools, only, k, max = 10 } = {}) {
  const p = path ? py.at(path) : py;
  const { root } = p.root();
  const project = await p.project();
  const venv = await p.venv();
  const declared = new Set([...(project.declaredNames ?? []), ...(project.toolSections ?? [])]);
  const files = new Set(project.configFiles ?? []);
  const wants = {
    pytest: declared.has("pytest") || files.has("pytest.ini") || files.has("conftest.py") || files.has("tests/conftest.py"),
    ruff: declared.has("ruff") || files.has("ruff.toml") || files.has(".ruff.toml"),
    mypy: declared.has("mypy") || files.has("mypy.ini") || files.has(".mypy.ini"),
    pyright: declared.has("pyright") || files.has("pyrightconfig.json"),
  };
  const order = ["pytest", "ruff", "mypy", "pyright"];
  const fs = await import("node:fs");
  const inVenv = (t) => !!venv.bin && ["", ".exe"].some((x) => fs.existsSync(`${venv.bin}/${t}${x}`));
  for (const t of order) if (venv.exists && inVenv(t)) wants[t] = true;
  const pick = tools?.length ? [].concat(tools) : order.filter((t) => wants[t]);
  const ran = [];
  const skipped = order.filter((t) => !pick.includes(t)).map((t) => ({ tool: t, reason: "the project neither declares nor configures it, and it is not installed in the virtualenv (pass tools to run it anyway)" }));
  if (!venv.exists) {
    return { root, venv: { exists: false, dir: venv.dir }, ran, skipped: pick.map((t) => ({ tool: t, reason: "the project has no virtualenv, so its packages are not installed (uv sync creates it)" })).concat(skipped), ok: null, headline: "no virtualenv: nothing was run" };
  }
  for (const t of pick) {
    let r;
    if (t === "pytest") r = await p.pytest({ path: only, k, max });
    else if (t === "ruff") r = await p.ruff({ path: only, max });
    else if (t === "mypy") r = await p.mypy({ path: only, max });
    else if (t === "pyright") r = await p.pyright({ path: only, max });
    else throw new Error(`unknown tool ${t}: pytest, ruff, mypy or pyright`);
    if (r.skipped) skipped.push({ tool: t, reason: r.skipped });
    else ran.push(r);
  }
  const bad = (r) => (r.tool === "pytest" ? r.code !== 0 : r.tool === "ruff" ? (r.counts?.violations ?? 1) > 0 || (r.format?.wouldReformat?.length ?? 0) > 0 || r.error : r.code !== 0);
  const headline = ran.map((r) => {
    if (r.tool === "pytest") return r.counts ? `pytest: ${r.counts.passed} passed, ${r.counts.failed} failed, ${r.counts.errors} errors, ${r.counts.skipped} skipped` : `pytest: ${r.meaning}`;
    if (r.tool === "ruff") return r.counts ? `ruff: ${r.counts.violations} violations (${r.counts.fixable} fixable), ${r.format?.wouldReformat?.length ?? 0} files to reformat` : `ruff: ${r.error ?? "no result"}`;
    if (r.tool === "mypy") return `mypy: ${r.summary ?? r.error ?? "no summary"}`;
    return `pyright: ${r.counts ? `${r.counts.errors} errors, ${r.counts.warnings} warnings` : r.error ?? "no result"}`;
  });
  return { root, venv: { exists: true, version: venv.version }, ran, skipped, ok: ran.length ? !ran.some(bad) : null, headline: headline.join("; ") || "nothing ran" };
}
