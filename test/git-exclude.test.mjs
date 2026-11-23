import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("ensureCodeshStateExcluded adds .codesh to local git excludes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-git-exclude-"))
  try {
    await mkdir(join(cwd, ".git", "info"), { recursive: true })

    const { ensureCodeshStateExcluded } = await import("../dist/git-exclude.js")
    ensureCodeshStateExcluded(cwd)
    ensureCodeshStateExcluded(cwd)

    const exclude = await readFile(join(cwd, ".git", "info", "exclude"), "utf8")
    assert.equal(exclude.match(/^\.codesh\/$/gm)?.length, 1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("ensureCodeshStateExcluded uses cwd-relative state path from nested repos", async () => {
  const repo = await mkdtemp(join(tmpdir(), "codesh-git-exclude-nested-"))
  try {
    await mkdir(join(repo, ".git", "info"), { recursive: true })
    await mkdir(join(repo, "packages", "app"), { recursive: true })

    const { ensureCodeshStateExcluded } = await import("../dist/git-exclude.js")
    ensureCodeshStateExcluded(join(repo, "packages", "app"))

    const exclude = await readFile(join(repo, ".git", "info", "exclude"), "utf8")
    assert.match(exclude, /^packages\/app\/\.codesh\/$/m)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test("ensureCodeshStateExcluded handles gitdir files used by worktrees", async () => {
  const root = await mkdtemp(join(tmpdir(), "codesh-git-exclude-worktree-"))
  try {
    const worktree = join(root, "worktree")
    const gitDir = join(root, "gitdir")
    await mkdir(join(gitDir, "info"), { recursive: true })
    await mkdir(worktree, { recursive: true })
    await writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`, "utf8")

    const { ensureCodeshStateExcluded } = await import("../dist/git-exclude.js")
    ensureCodeshStateExcluded(worktree)

    const exclude = await readFile(join(gitDir, "info", "exclude"), "utf8")
    assert.match(exclude, /^\.codesh\/$/m)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
