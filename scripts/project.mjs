export const meta = {
  purpose:
    "What pyproject.toml declares: name, version, requires-python, build backend and whether uv installs the project itself, [project.scripts] and other entry points, dependencies, optional dependencies, dependency groups, tool.uv settings, and the configuration of ruff, mypy, pytest and pyright (from pyproject.toml, ruff.toml and the other files that can hold it).",
  params: { path: "another project folder, optional", only: "an array of the keys to return, optional (e.g. [\"scripts\", \"tools\"])" },
  returns:
    "{root, file, name, version, requiresPython, buildBackend, packaged, packagedNote, scripts, guiScripts, entryPoints, dependencies, optionalDependencies, dependencyGroups, uv, toolSections, tools:{ruff, mypy, pytest, pyright}, configFiles, declaredNames}",
  example: 'await scripts.run("project", { only: ["scripts", "dependencyGroups", "tools"] })',
};

export default async function ({ py }, { path, only } = {}) {
  const p = path ? py.at(path) : py;
  const all = await p.project();
  if (!only?.length) return all;
  return { root: all.root, file: all.file, ...Object.fromEntries([].concat(only).map((k) => [k, all[k] ?? null])) };
}
