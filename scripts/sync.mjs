export const meta = {
  purpose:
    "Whether the virtualenv matches uv.lock and uv.lock matches pyproject.toml, without changing either: the packages uv sync would install, remove or change, and whether the lock is out of date. Runs uv lock --check and uv sync --dry-run offline.",
  params: { path: "another project folder, optional", allGroups: "check with every dependency group, default false (the default groups, as uv sync does)", allExtras: "check with every optional extra, default false", group: "one extra dependency group to include, optional", extra: "one extra to include, optional" },
  returns:
    "{root, lockCurrent: true|false|null, lockNote, envInSync: true|false|null, wouldInstall:[{name, version}], wouldRemove:[...], wouldChange:[...], environment, raw, fix:[sentences]}",
  example: 'await scripts.run("sync")',
};

export default async function ({ py }, { path, allGroups = false, allExtras = false, group, extra } = {}) {
  const p = path ? py.at(path) : py;
  const { root, lockRoot } = p.root();
  const out = { root, lockRoot };
  const fix = [];
  const lockFile = lockRoot ? `${lockRoot}/uv.lock` : null;

  const venv = await p.venv();
  let chk = await p.run("uv", "lock", "--check", "--offline");
  const noInterpreter = (r) => /No interpreter found|Python.*(not found|could not)/i.test(r.err + r.out);
  if (chk.code !== 0 && noInterpreter(chk) && venv.exists && venv.executable) {
    out.pythonError = (chk.err + chk.out).trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400);
    chk = await p.run("uv", "lock", "--check", "--offline", "--python", venv.executable);
  }
  if (chk.missing) return { ...out, error: "uv is not installed or not on PATH" };
  const msg = (chk.err + chk.out).trim();
  if (chk.code === 0) {
    out.lockCurrent = true;
    out.lockNote = lockFile ? "uv.lock agrees with pyproject.toml" : "uv found nothing to lock";
  } else if (/needs to be updated|would be updated|lockfile.*(out of date|missing)|Unable to find lockfile/i.test(msg)) {
    out.lockCurrent = false;
    out.lockNote = msg.split("\n").filter(Boolean).slice(-2).join(" ");
  } else {
    out.lockCurrent = null;
    out.lockNote = `uv could not decide offline: ${msg.split("\n").filter(Boolean).slice(-2).join(" ").replace(/\s+/g, " ").slice(0, 300)}`;
  }
  // Compare what pyproject.toml declares with what the lock recorded for the project itself.
  if (out.lockCurrent !== true && lockFile) {
    const [project, lock] = [await p.project(), await p.lock()];
    const nm = (x) => String(x).toLowerCase().replace(/[-_.]+/g, "-");
    const base = (x) => nm(String(x).match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1] ?? x);
    const me = lock?.packages.find((x) => nm(x.name) === nm(project.name ?? ""));
    if (me) {
      const miss = [];
      const lockedDeps = new Set(me.deps.map(nm));
      for (const d of project.dependencies ?? []) if (typeof d === "string" && !d.startsWith("[") && !lockedDeps.has(base(d))) miss.push({ name: base(d), in: "dependencies" });
      for (const [g, list] of Object.entries(project.dependencyGroups ?? {})) {
        const have = new Set((me.groups?.[g] ?? []).map(nm));
        for (const d of list) if (typeof d === "string" && !d.startsWith("[") && !d.startsWith("include-group") && !have.has(base(d))) miss.push({ name: base(d), in: `group ${g}` });
      }
      for (const [g, list] of Object.entries(project.optionalDependencies ?? {})) {
        const have = new Set((me.extras?.[g] ?? []).map(nm));
        for (const d of list) if (typeof d === "string" && !d.startsWith("[") && !have.has(base(d))) miss.push({ name: base(d), in: `extra ${g}` });
      }
      if (miss.length) {
        out.declaredNotLocked = miss.slice(0, 30);
        if (out.lockCurrent === null) {
          out.lockCurrent = false;
          out.lockNote = `uv.lock is out of date: pyproject.toml declares ${miss.map((m) => `${m.name} (${m.in})`).join(", ")}, which the lock does not have`;
        }
      }
    }
  }
  if (out.lockCurrent === false) fix.push("uv.lock does not match pyproject.toml: uv lock brings it up to date (needs act)");

  const args = ["sync", "--dry-run", "--frozen", "--offline"];
  if (allGroups) args.push("--all-groups");
  if (allExtras) args.push("--all-extras");
  if (group) args.push("--group", group);
  if (extra) args.push("--extra", extra);
  let r = await p.run("uv", ...args);
  let note = null;
  if (r.code !== 0 && noInterpreter(r) && venv.exists && venv.executable) {
    note = "uv could not find the interpreter that the pin and requires-python choose, so lock and packages are compared using the virtualenv's own interpreter";
    out.pythonError ??= (r.err + r.out).trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400);
    r = await p.run("uv", ...args, "--python", venv.executable);
  }
  const text = r.err + "\n" + r.out;
  if (r.code !== 0) {
    out.envInSync = null;
    out.error = text.trim().split("\n").filter(Boolean).slice(-4).join(" ").slice(0, 500);
    return { ...out, fix };
  }
  const rows = { install: [], remove: [], change: [] };
  for (const l of text.split("\n")) {
    const m = l.match(/^\s*([+\-~])\s+([A-Za-z0-9._-]+)(?:==([^\s]+))?(?:\s|$)/);
    if (!m) continue;
    const row = { name: m[2], ...(m[3] ? { version: m[3] } : {}) };
    (m[1] === "+" ? rows.install : m[1] === "-" ? rows.remove : rows.change).push(row);
  }
  const counts = text.match(/Would (?:install|uninstall|reinstall|download)[^\n]*/g) ?? [];
  // A package that is both removed and installed is a version change.
  const changed = [];
  for (const r1 of [...rows.install]) {
    const gone = rows.remove.find((x) => x.name === r1.name);
    if (gone) {
      changed.push({ name: r1.name, installed: gone.version, lockHas: r1.version });
      rows.install.splice(rows.install.indexOf(r1), 1);
      rows.remove.splice(rows.remove.indexOf(gone), 1);
    }
  }
  out.envInSync = !rows.install.length && !rows.remove.length && !rows.change.length && !changed.length && /Would make no changes/.test(text);
  out.wouldInstall = rows.install.slice(0, 40);
  out.wouldRemove = rows.remove.slice(0, 40);
  out.wouldChange = [...changed, ...rows.change].slice(0, 40);
  out.environment = (text.match(/Would use project environment at:\s*(.+)/)?.[1] ?? text.match(/Would (?:create|recreate)[^\n]*/)?.[0] ?? "").trim() || null;
  out.summary = counts.concat((text.match(/Would make no changes/) ?? [])).slice(0, 6);
  if (note) out.note = note;
  const created = /Would (?:create|recreate) virtual environment/i.test(text);
  if (created) {
    out.envInSync = false;
    fix.push("the virtualenv would be created or recreated: uv sync (needs act)");
  }
  if (rows.install.length || rows.remove.length || rows.change.length || changed.length) fix.push("the virtualenv differs from uv.lock: uv sync --frozen (or uv sync) brings it in line (needs act)");
  if (!out.envInSync && !fix.length) out.raw = text.trim().split("\n").slice(-8).join("\n");
  return { ...out, fix };
}
