import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withTemporaryHomeWorkspace } from "../helpers/workspace.mjs"

async function makeRepo(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "codesh-evolve-root-"))
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: options.name ?? "codesh" }), "utf8")
  if (options.src !== false) {
    await mkdir(join(dir, "src", "evolve"), { recursive: true })
    await writeFile(join(dir, "src", "cli.ts"), "", "utf8")
    await writeFile(join(dir, "src", "evolve", "orchestrator.ts"), "", "utf8")
  }
  if (options.git !== false) await mkdir(join(dir, ".git"), { recursive: true })
  return dir
}

test("resolveCodeshRoot finds the root from a nested directory", async () => {
  const { resolveCodeshRoot } = await import("../../dist/evolve/root.js")
  const dir = await makeRepo()
  try {
    await mkdir(join(dir, "src", "evolve"), { recursive: true })
    const result = resolveCodeshRoot(join(dir, "src", "evolve"))
    assert.equal(result.available, true)
    assert.equal(result.root, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("resolveCodeshRoot reports no-source when src/ is absent", async () => {
  const { resolveCodeshRoot } = await import("../../dist/evolve/root.js")
  const dir = await makeRepo({ src: false })
  try {
    const result = resolveCodeshRoot(dir)
    assert.equal(result.available, false)
    assert.equal(result.reason, "no-source")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("resolveCodeshRoot reports not-git when root is not a worktree", async () => {
  const { resolveCodeshRoot } = await import("../../dist/evolve/root.js")
  const dir = await makeRepo({ git: false })
  try {
    const result = resolveCodeshRoot(dir)
    assert.equal(result.available, false)
    assert.equal(result.reason, "not-git")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("resolveCodeshRoot reports no-source when no codesh package.json is found", async () => {
  const { resolveCodeshRoot } = await import("../../dist/evolve/root.js")
  const dir = await mkdtemp(join(tmpdir(), "codesh-evolve-root-none-"))
  try {
    const result = resolveCodeshRoot(dir)
    assert.equal(result.available, false)
    assert.equal(result.reason, "no-source")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("resolveOrPrepareCodeshRoot provisions a version-matched managed checkout for npm installs", async () => {
  const { resolveOrPrepareCodeshRoot } = await import("../../dist/evolve/root.js")
  await withTemporaryHomeWorkspace("codesh-managed-root-", async (installedRoot, home) => {
    await writeFile(join(installedRoot, "package.json"), JSON.stringify({ name: "codesh", version: "9.8.7" }), "utf8")
    await mkdir(join(installedRoot, "dist"), { recursive: true })
    await mkdir(join(installedRoot, "src", "ui", "pi"), { recursive: true })
    await writeFile(join(installedRoot, "src", "ui", "pi", "LICENSE"), "packaged license\n", "utf8")
    const commands = []
    const result = await resolveOrPrepareCodeshRoot({
      startDir: join(installedRoot, "dist"),
      managedSourceDeps: {
        prepareBaseline: async (root) => {
          await mkdir(join(root, "dist"), { recursive: true })
          await writeFile(join(root, "dist", "cli.js"), "// baseline\n", "utf8")
          return { ok: true, log: "" }
        },
        run: async (command) => {
          commands.push(command)
          if (command.command === "git") {
            const staging = command.args.at(-1)
            await mkdir(join(staging, ".git"), { recursive: true })
            await mkdir(join(staging, "src", "evolve"), { recursive: true })
            await writeFile(join(staging, "src", "cli.ts"), "", "utf8")
            await writeFile(join(staging, "src", "evolve", "orchestrator.ts"), "", "utf8")
            await writeFile(join(staging, "package.json"), JSON.stringify({ name: "codesh", version: "9.8.7" }), "utf8")
          }
          return { ok: true, log: "" }
        },
      },
    })

    assert.equal(result.available, true)
    assert.equal(result.managed, true)
    assert.equal(result.root, join(home, ".codesh", "evolve", "sources", "v9.8.7"))
    assert.equal(await readFile(join(result.root, "dist", "cli.js"), "utf8"), "// baseline\n")
    assert.deepEqual(commands.map(({ command }) => command), ["git", process.platform === "win32" ? "npm.cmd" : "npm"])
    assert.deepEqual(commands[0].args.slice(0, 5), ["clone", "--branch", "v9.8.7", "--depth", "1"])
  })
})

test("managed checkout falls back to npm gitHead when the release tag is missing", async () => {
  const { prepareManagedCodeshSource } = await import("../../dist/evolve/managed-source.js")
  await withTemporaryHomeWorkspace("codesh-managed-githead-", async (_workspace, home) => {
    const gitHead = "1234567890abcdef1234567890abcdef12345678"
    const commands = []
    const result = await prepareManagedCodeshSource({
      version: "9.8.7",
      deps: {
        prepareBaseline: async (root) => {
          await mkdir(join(root, "dist"), { recursive: true })
          await writeFile(join(root, "dist", "cli.js"), "// baseline\n", "utf8")
          return { ok: true, log: "" }
        },
        run: async (command) => {
          commands.push(command)
          if (command.command.endsWith("npm") || command.command.endsWith("npm.cmd")) {
            if (command.args[0] === "view") return { ok: true, log: gitHead }
            return { ok: true, log: "" }
          }
          if (command.args.includes("--branch")) {
            return { ok: false, log: "Remote branch v9.8.7 not found" }
          }
          if (command.args[0] === "clone") {
            await mkdir(join(command.args.at(-1), ".git"), { recursive: true })
            return { ok: true, log: "" }
          }
          if (command.args[0] === "checkout") {
            await mkdir(join(command.cwd, "src", "evolve"), { recursive: true })
            await writeFile(join(command.cwd, "src", "cli.ts"), "", "utf8")
            await writeFile(join(command.cwd, "src", "evolve", "orchestrator.ts"), "", "utf8")
            await writeFile(join(command.cwd, "package.json"), JSON.stringify({ name: "codesh", version: "9.8.7" }), "utf8")
            return { ok: true, log: "" }
          }
          return { ok: false, log: "unexpected command" }
        },
      },
    })

    assert.equal(result.available, true)
    assert.equal(result.root, join(home, ".codesh", "evolve", "sources", "v9.8.7"))
    assert.deepEqual(commands.map(({ args }) => args[0]), ["clone", "view", "clone", "checkout", "ci"])
    assert.equal(commands[3].args.at(-1), gitHead)
  })
})

test("isGitWorktree recognizes a gitdir worktree file", async () => {
  const { isGitWorktree } = await import("../../dist/evolve/root.js")
  const dir = await mkdtemp(join(tmpdir(), "codesh-evolve-worktree-"))
  try {
    await writeFile(join(dir, ".git"), "gitdir: /somewhere/else\n", "utf8")
    assert.equal(isGitWorktree(dir), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
