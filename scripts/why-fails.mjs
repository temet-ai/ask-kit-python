export const meta = {
  purpose:
    "Why an import or a command fails in the project's environment: tries the import in the virtualenv's interpreter and, when it fails, tells which of these it is: no virtualenv, the project itself is not installed (no build-system), the package is declared but not synced (and which group or extra to ask for), declared but missing from uv.lock, not declared at all, installed under a different distribution name, or the import raised inside the package. For a command (a [project.scripts] entry or a tool such as pytest) it checks the virtualenv's bin folder the same way.",
  params: { module: "a module to import, e.g. \"yaml\" or \"clacks.cli\", optional", package: "the distribution that should provide it, optional (default: the module's top-level name)", command: "an executable that uv run or the shell cannot find, optional", path: "another project folder, optional" },
  returns:
    "{root, venv:{exists, version}, import:{module, found, imported, error, traceback}|null, command:{name, inBin, ...}|null, declared:{where:[...]}|null, inLock, installed:{name, version}|null, diagnosis:[sentences], next:[sentences]}",
  example: 'await scripts.run("why-fails", { module: "yaml" })',
};

const norm = (s) => String(s).toLowerCase().replace(/[-_.]+/g, "-");

export default async function ({ py }, { module, package: pkgArg, command, path } = {}) {
  const p = path ? py.at(path) : py;
  if (!module && !command) throw new Error("pass module (an import that fails) or command (an executable that is not found)");
  const { root } = p.root();
  const [project, venv, lock] = [await p.project(), await p.venv(), await p.lock().catch(() => null)];
  const out = { root, venv: { exists: venv.exists, dir: venv.dir, version: venv.version ?? null, source: venv.source } };
  const diagnosis = [];
  const next = [];

  if (!venv.exists) {
    diagnosis.push(`there is no virtualenv at ${venv.dir}: nothing is installed anywhere for this project`);
    next.push("uv sync creates the virtualenv and installs the locked packages (needs act)");
  } else if (venv.broken) {
    diagnosis.push(`the virtualenv's interpreter does not run (${venv.broken}); every import fails`);
    next.push("recreate it: uv venv, then uv sync (needs act)");
  } else if (venv.homeExists === false) {
    diagnosis.push(`the virtualenv's base interpreter ${venv.home} is gone`);
    next.push("recreate the virtualenv: uv venv, then uv sync (needs act)");
  }
  if (venv.exists && venv.version && project.requiresPython && p.satisfies(venv.version, project.requiresPython) === false) {
    diagnosis.push(`the virtualenv runs Python ${venv.version}, outside requires-python ${project.requiresPython}`);
    next.push("recreate the virtualenv with an interpreter that satisfies it (uv sync --python <version>, needs act)");
  }

  // Where a distribution is declared, and what asking for it takes.
  const declaredWhere = (name) => {
    const n = norm(name);
    const at = [];
    const has = (list) => (list ?? []).some((x) => typeof x === "string" && norm(x.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1] ?? "") === n);
    if (has(project.dependencies)) at.push({ in: "dependencies", flag: null });
    for (const [k, v] of Object.entries(project.optionalDependencies ?? {})) if (has(v)) at.push({ in: `optional extra "${k}"`, flag: `--extra ${k}` });
    const defaults = project.uv?.defaultGroups ?? ["dev"];
    for (const [k, v] of Object.entries(project.dependencyGroups ?? {})) if (has(v)) at.push({ in: `dependency group "${k}"`, flag: defaults.includes(k) || defaults === "all" ? null : `--group ${k}` });
    if (has(project.legacyDevDependencies)) at.push({ in: "tool.uv.dev-dependencies", flag: null });
    return at;
  };
  const installed = venv.exists && !venv.broken ? await p.installed() : [];
  const lockHas = (name) => lock?.packages.find((x) => norm(x.name) === norm(name)) ?? null;
  const explain = (name) => {
    const at = declaredWhere(name);
    const inst = installed.find((x) => norm(x.name) === norm(name)) ?? null;
    const l = lockHas(name);
    return { name, declared: at, inLock: l ? { version: l.version, source: l.source } : null, installed: inst ? { name: inst.name, version: inst.version } : null };
  };

  if (!venv.exists || venv.broken) {
    const name = pkgArg ?? (module ? module.split(".")[0] : command);
    const e = explain(name);
    out.declared = e.declared;
    out.inLock = e.inLock;
    if (e.declared.length) diagnosis.push(`${name} is declared (${e.declared.map((d) => d.in).join(", ")}); it will be installed once the virtualenv exists`);
    else diagnosis.push(`${name} is not declared in pyproject.toml`);
    return { ...out, diagnosis, next };
  }

  if (module) {
    const imp = await p.tryImport(module);
    out.import = imp;
    const top = module.split(".")[0];
    if (imp.imported) {
      diagnosis.push(`${module} imports without error in the virtualenv's interpreter (${venv.version}), from ${imp.origin ?? "?"}`);
      next.push("the failure comes from another interpreter: compare with the one that fails (python -c 'import sys; print(sys.executable)' in that shell, or uv run python -c ...), or the traceback is from code that runs after the import");
    } else if (imp.found && imp.imported === false) {
      diagnosis.push(`${module} exists (${imp.origin}) but raises on import: ${imp.error}`);
      const ie = imp.error ?? "";
      const missing = ie.match(/No module named '([^']+)'/)?.[1];
      if (missing) {
        const e2 = explain(missing.split(".")[0]);
        out.cause = e2;
        diagnosis.push(`it needs ${missing}, which ${e2.installed ? `is installed as ${e2.installed.name} ${e2.installed.version}, but does not provide that module` : "is not installed"}${e2.declared.length ? `; it is declared in ${e2.declared.map((d) => d.in).join(", ")}` : "; it is not declared in pyproject.toml"}`);
        if (!e2.installed && e2.declared.length) next.push(`uv sync${e2.declared[0].flag ? " " + e2.declared[0].flag : ""} (needs act)`);
        else if (!e2.declared.length) next.push(`uv add ${missing.split(".")[0]} (needs act) if the package is meant to be a dependency; the import name can differ from the distribution name`);
      }
      if (/cannot import name/.test(ie)) next.push("the installed version of the package lacks that name: compare the installed version with what the code expects (py.installed(), uv.lock)");
      if (/undefined symbol|cannot open shared object|DLL load failed|incompatible architecture/.test(ie)) next.push("a compiled extension does not match this interpreter or machine: run the wheels script to see which packages have no wheel for this Python");
      if (/NumPy|numpy\.core|_ARRAY_API/.test(ie)) next.push("a compiled package was built against another numpy: check the numpy version in uv.lock against the package that fails");
    } else {
      // Not found.
      let dist = pkgArg ?? top;
      if (!pkgArg && !declaredWhere(dist).length && !installed.some((x) => norm(x.name) === norm(dist))) {
        // The import name often differs from the distribution name (yaml from PyYAML): look for a declared name that contains it.
        const near = (project.declaredNames ?? []).filter((n) => n !== norm(dist) && (n.includes(norm(top)) || norm(top).includes(n)));
        if (near.length) {
          diagnosis.push(`the import name ${top} is probably provided by the declared distribution ${near[0]}`);
          dist = near[0];
        }
      }
      const e = explain(dist);
      out.declared = e.declared;
      out.inLock = e.inLock;
      out.installed = e.installed;
      const ownPackage = project.name && norm(project.name) === norm(top.replace(/_/g, "-"));
      const byTop = installed.filter((x) => x.top?.includes(top));
      if (venv.exists && !venv.broken && ownPackage && !project.packaged) {
        diagnosis.push(`${top} is this project's own package, but the project is not installed into the virtualenv: ${project.packagedNote}`);
        next.push("add a [build-system] to pyproject.toml (for example with uv init --package, or hatchling) or set [tool.uv] package = true, then uv sync (needs act); for a quick run, uv run --with-editable . or PYTHONPATH=src");
      } else if (venv.exists && !venv.broken && ownPackage && project.packaged && !e.installed) {
        diagnosis.push(`${top} is this project's own package and the project is packaged, but it is not installed in the virtualenv`);
        next.push("uv sync installs the project itself (needs act)");
      } else if (e.installed) {
        diagnosis.push(`the distribution ${e.installed.name} ${e.installed.version} is installed but does not provide a module named ${top}${byTop.length ? `; ${top} comes from ${byTop.map((x) => x.name).join(", ")}` : ""}`);
        next.push(`the module name differs from the distribution name (for example yaml comes from PyYAML): ${byTop.length ? `declare ${byTop[0].name}` : "pass package with the right distribution name"}`);
      } else if (byTop.length) {
        diagnosis.push(`no module ${top} is importable, but ${byTop.map((x) => x.name).join(", ")} is installed and has files named ${top}: it may be a namespace or a broken install`);
      } else if (e.declared.length && e.inLock) {
        const flag = e.declared[0].flag;
        diagnosis.push(`${dist} is declared (${e.declared.map((d) => d.in).join(", ")}) and locked (${e.inLock.version}) but is not installed in the virtualenv: the environment was not synced after it was added${flag ? `, and it is outside the default groups, so uv sync needs ${flag}` : ""}`);
        next.push(`uv sync${flag ? " " + flag : ""} (needs act)`);
      } else if (e.declared.length && !e.inLock) {
        diagnosis.push(`${dist} is declared (${e.declared.map((d) => d.in).join(", ")}) but is not in uv.lock${lock ? "" : " (there is no uv.lock)"}: the lock is stale`);
        next.push("uv lock, then uv sync (needs act)");
      } else if (e.inLock) {
        diagnosis.push(`${dist} is in uv.lock (${e.inLock.version}) as a dependency of something else, not declared by the project, and not installed: it may belong to a marker (another platform or Python version) or an unsynced group`);
        next.push("run the sync script to see what uv sync would install");
      } else if (venv.exists && !venv.broken) {
        diagnosis.push(`${dist} is not declared in pyproject.toml, not in uv.lock and not installed: nothing provides ${top}${imp.findError ? ` (${imp.findError})` : ""}`);
        next.push(`uv add ${dist} (needs act), if ${dist} is the right distribution name for the import ${top}`);
      }
    }
  }

  if (command) {
    const fs = await import("node:fs");
    const bin = venv.bin ?? null;
    const inBin = !!bin && ["", ".exe"].some((x) => fs.existsSync(`${bin}/${command}${x}`));
    const c = { name: command, inBin, bin };
    const sc = (project.scripts ?? {})[command] ?? (project.guiScripts ?? {})[command];
    if (sc) c.declaredScript = sc;
    out.command = c;
    if (inBin) diagnosis.push(`${command} exists in ${bin}: uv run ${command} finds it; if it still fails, the error comes from the program itself`);
    else if (sc && !project.packaged) {
      diagnosis.push(`${command} is a [project.scripts] entry (${sc}) but ${project.packagedNote}`);
      next.push("add a [build-system] or set [tool.uv] package = true, then uv sync (needs act); or run it as uv run python -m <module>");
    } else if (sc) {
      diagnosis.push(`${command} is a [project.scripts] entry (${sc}) and the project is packaged, but ${venv.exists ? "the virtualenv has no such script" : "there is no virtualenv"}`);
      next.push("uv sync installs the project and its scripts (needs act)");
    } else {
      const e = explain(command);
      c.declared = e.declared;
      c.installed = e.installed;
      if (e.declared.length && !e.installed) {
        const flag = e.declared[0].flag;
        diagnosis.push(`${command} is declared (${e.declared.map((d) => d.in).join(", ")}) but not installed in the virtualenv${flag ? `; it is outside the default groups, so uv sync needs ${flag}` : ""}`);
        next.push(`uv sync${flag ? " " + flag : ""} (needs act)`);
      } else if (!e.declared.length) {
        diagnosis.push(`${command} is not in ${bin ?? "the virtualenv"}, not a [project.scripts] entry and not declared as a dependency`);
        next.push(`uv add --dev ${command} (needs act) if it is a tool the project uses; uv tool install ${command} for a tool outside the project`);
      } else diagnosis.push(`${command} is installed (${e.installed.version}) but ships no executable of that name; check the distribution's own script names`);
    }
  }

  if (!diagnosis.length) diagnosis.push("no cause found in the virtualenv, the declarations or the lock; the raw import result is in `import`");
  return { ...out, diagnosis, next };
}
