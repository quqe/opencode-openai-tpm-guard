import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Glob } from "@opencode/util/glob"

// Resolve the transitive dependencies as OpenCode's utility package does.
const requireFromUtil = createRequire(import.meta.resolve("@opencode/util/glob"))
const mapWorkspaces = requireFromUtil("@npmcli/map-workspaces")
const Arborist = requireFromUtil("@npmcli/arborist")
const packlist = requireFromUtil("npm-packlist")

test("overridden glob dependencies preserve common workspace and ignore behavior", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tpm-guard-deps-"))
  try {
    for (const name of ["included", "excluded"]) {
      const workspace = join(dir, "packages", name)
      mkdirSync(workspace, { recursive: true })
      writeFileSync(join(workspace, "package.json"), JSON.stringify({ name, version: "1.0.0" }))
      writeFileSync(join(workspace, "index.js"), "")
    }
    const workspaces = await mapWorkspaces({
      cwd: dir,
      pkg: { workspaces: ["packages/*", "!packages/excluded"] },
    })
    assert.deepEqual([...workspaces.keys()], ["included"])
    assert.equal(Glob.match("**/*.js", "packages/included/index.js"), true)
    assert.deepEqual(
      await Glob.scan("packages/**/*.js", { cwd: dir, ignore: ["**/excluded/**"] }),
      ["packages/included/index.js"],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("overridden matching dependencies preserve package ignore rules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tpm-guard-packlist-"))
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))
    writeFileSync(join(dir, ".npmignore"), "*.secret\n!important.secret\n")
    writeFileSync(join(dir, "private.secret"), "private")
    writeFileSync(join(dir, "important.secret"), "included")
    writeFileSync(join(dir, "index.js"), "")
    const tree = await new Arborist({ path: dir }).loadActual()
    const files = await packlist(tree)
    assert.ok(files.includes("index.js"))
    assert.ok(files.includes("important.secret"))
    assert.ok(!files.includes("private.secret"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
