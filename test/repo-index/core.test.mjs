import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("repo index offer is based on git repo and .codesh/repo-index.md existence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-repo-index-"))
  try {
    const { repoIndexPath, shouldOfferRepoIndex } = await import("../../dist/repo-index/core.js")

    assert.equal(await shouldOfferRepoIndex(cwd), false)

    await mkdir(join(cwd, ".git"), { recursive: true })
    assert.equal(await shouldOfferRepoIndex(cwd), true)

    await mkdir(join(cwd, ".codesh"), { recursive: true })
    await writeFile(repoIndexPath(cwd), "# Existing index\n", "utf8")
    assert.equal(await shouldOfferRepoIndex(cwd), false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("declining repo index onboarding is persisted and suppresses future prompts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-repo-index-decline-"))
  try {
    const {
      readRepoIndexMeta,
      recordRepoIndexOnboardingDecision,
      shouldOfferRepoIndex,
    } = await import("../../dist/repo-index/core.js")
    await mkdir(join(cwd, ".git"), { recursive: true })

    assert.equal(await shouldOfferRepoIndex(cwd), true)
    await recordRepoIndexOnboardingDecision(cwd, "declined")
    assert.equal(await shouldOfferRepoIndex(cwd), false)
    assert.equal((await readRepoIndexMeta(cwd)).onboardingDecision, "declined")
    await recordRepoIndexOnboardingDecision(cwd, "accepted")
    assert.equal(await shouldOfferRepoIndex(cwd), false)
    assert.equal((await readRepoIndexMeta(cwd)).onboardingDecision, "accepted")
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("nested launches resolve repo index state at one worktree root", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-repo-index-root-"))
  try {
    const { resolveRepoRoot } = await import("../../dist/repo-index/core.js")
    const nested = join(cwd, "packages", "app")
    await mkdir(join(cwd, ".git"), { recursive: true })
    await mkdir(nested, { recursive: true })
    assert.equal(await resolveRepoRoot(nested), cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("repo index staleness uses simple sidecar metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-repo-index-meta-"))
  try {
    const { getRepoIndexStaleness, repoIndexMetaPath, repoIndexPath } = await import("../../dist/repo-index/core.js")

    await mkdir(join(cwd, ".git"), { recursive: true })
    await mkdir(join(cwd, ".codesh"), { recursive: true })
    await writeFile(join(cwd, ".git", "HEAD"), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", "utf8")
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "demo" }), "utf8")
    await writeFile(repoIndexPath(cwd), "# Existing index\n", "utf8")

    assert.deepEqual(await getRepoIndexStaleness(cwd), { reason: "metadata missing", stale: true })

    await writeFile(repoIndexMetaPath(cwd), `${JSON.stringify({
      fileCount: 1,
      generatedAt: "2026-07-10T00:00:00.000Z",
      gitHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      packageName: "demo",
    })}\n`, "utf8")
    assert.deepEqual(await getRepoIndexStaleness(cwd), { stale: false })

    await writeFile(join(cwd, ".git", "HEAD"), "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", "utf8")
    assert.deepEqual(await getRepoIndexStaleness(cwd), { reason: "git commit changed", stale: true })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("repo index snapshot skips noisy dirs and secret-like files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-repo-index-snapshot-"))
  try {
    await mkdir(join(cwd, ".git"), { recursive: true })
    await mkdir(join(cwd, "src"), { recursive: true })
    await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true })
    await writeFile(join(cwd, "README.md"), "# Demo\n", "utf8")
    await writeFile(join(cwd, "src", "cli.ts"), "export {}\n", "utf8")
    await writeFile(join(cwd, ".env"), "TOKEN=secret\n", "utf8")
    await writeFile(join(cwd, "node_modules", "pkg", "index.js"), "module.exports = {}\n", "utf8")

    const { collectRepoIndexSnapshot } = await import("../../dist/repo-index/core.js")
    const snapshot = await collectRepoIndexSnapshot(cwd)

    assert(snapshot.files.includes("README.md"))
    assert(snapshot.files.includes("src/cli.ts"))
    assert(!snapshot.files.includes(".env"))
    assert(!snapshot.files.some((file) => file.startsWith("node_modules/")))
    assert.equal(snapshot.snippets[0].path, "README.md")
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("provider failures do not write an index or metadata file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-repo-index-provider-failure-"))
  try {
    await mkdir(join(cwd, ".git"), { recursive: true })
    await writeFile(join(cwd, "README.md"), "# Demo\n", "utf8")
    const { generateRepoIndex, repoIndexMetaPath, repoIndexPath } = await import("../../dist/repo-index/core.js")
    const config = {
      apiKey: "invalid",
      appName: "Codesh",
      model: "gpt-4o-mini",
      modelSettings: {},
      provider: "openai",
      providerConfig: {
        apiKey: "invalid",
        appName: "Codesh",
        baseUrl: "http://127.0.0.1:1/v1",
        defaultModel: "gpt-4o-mini",
        displayName: "OpenAI",
        id: "openai",
        protocol: "openai-compatible",
        siteUrl: "http://localhost",
      },
      siteUrl: "http://localhost",
    }

    await assert.rejects(generateRepoIndex({ config, cwd }))
    await assert.rejects(access(repoIndexPath(cwd)))
    await assert.rejects(access(repoIndexMetaPath(cwd)))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("DeepSeek repo indexing retries V4 Flash when V4 Pro fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codesh-repo-index-deepseek-fallback-"))
  try {
    await mkdir(join(cwd, ".git"), { recursive: true })
    await writeFile(join(cwd, "README.md"), "# Demo\n", "utf8")
    const { generateRepoIndex } = await import("../../dist/repo-index/core.js")
    const attemptedModels = []
    const config = {
      apiKey: "test-key",
      appName: "Codesh",
      model: "deepseek-v4-pro",
      modelSettings: {},
      provider: "deepseek",
      providerConfig: {
        apiKey: "test-key",
        appName: "Codesh",
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-v4-pro",
        displayName: "DeepSeek",
        id: "deepseek",
        protocol: "openai-compatible",
        siteUrl: "http://localhost",
      },
      siteUrl: "http://localhost",
    }
    const result = await generateRepoIndex({
      complete: async (_config, _messages, options) => {
        attemptedModels.push(options.model)
        if (options.model === "deepseek-v4-pro") throw new Error("V4 Pro unavailable")
        return "## Project Shape\n\n- Demo"
      },
      config,
      cwd,
    })

    assert.deepEqual(attemptedModels, ["deepseek-v4-pro", "deepseek-v4-flash"])
    assert.equal(result.model, "deepseek-v4-flash")
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("repo index model selector prefers fast provider-compatible models", async () => {
  const { repoIndexModelCandidates, selectRepoIndexModel } = await import("../../dist/repo-index/core.js")
  const baseConfig = {
    model: "anthropic/claude-sonnet-4.6",
    provider: "openrouter",
    providerConfig: { defaultModel: "anthropic/claude-sonnet-4.6" },
    titleModel: "openai/gpt-4o-mini",
  }

  assert.equal(
    selectRepoIndexModel(baseConfig, [
      { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet" },
      { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" },
    ]),
    "anthropic/claude-haiku-4.5",
  )

  assert.equal(
    selectRepoIndexModel({ ...baseConfig, provider: "anthropic", providerConfig: { defaultModel: "claude-sonnet-4-6" } }, [
      { id: "claude-sonnet-4-6", name: "Claude Sonnet" },
      { id: "claude-haiku-4-5", name: "Claude Haiku" },
    ]),
    "claude-haiku-4-5",
  )

  assert.equal(
    selectRepoIndexModel({ ...baseConfig, provider: "openai", providerConfig: { defaultModel: "gpt-4.1" } }, [
      { id: "gpt-4.1", name: "GPT 4.1" },
      { id: "gpt-4o-mini", name: "GPT 4o mini" },
      { id: "gpt-5", name: "GPT 5" },
    ]),
    "gpt-5",
  )

  assert.equal(
    selectRepoIndexModel({ ...baseConfig, provider: "deepseek", providerConfig: { defaultModel: "deepseek-chat" } }, [
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", providerId: "deepseek" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "deepseek" },
    ]),
    "deepseek-v4-pro",
  )
  assert.deepEqual(
    repoIndexModelCandidates({ ...baseConfig, provider: "deepseek", providerConfig: { defaultModel: "deepseek-chat" } }, [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "deepseek" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", providerId: "deepseek" },
    ]),
    ["deepseek-v4-pro", "deepseek-v4-flash"],
  )
  assert.deepEqual(
    repoIndexModelCandidates({ ...baseConfig, provider: "deepseek", providerConfig: { defaultModel: "deepseek-chat" } }),
    ["deepseek-v4-pro", "deepseek-v4-flash"],
  )
  assert.deepEqual(
    repoIndexModelCandidates({ ...baseConfig, provider: "openai", model: "gpt-4.1", providerConfig: { defaultModel: "gpt-4.1" } }, [
      { id: "gpt-4.1", name: "GPT 4.1", providerId: "openai" },
      { id: "gpt-4o-mini", name: "GPT 4o Mini", providerId: "openai" },
      { id: "gpt-5", name: "GPT 5", providerId: "openai" },
    ]),
    ["gpt-5", "gpt-4o-mini", "gpt-4.1"],
  )
  assert.deepEqual(
    repoIndexModelCandidates({ ...baseConfig, provider: "anthropic", model: "claude-sonnet-4-6", providerConfig: { defaultModel: "claude-sonnet-4-6" } }, [
      { id: "claude-sonnet-4-6", name: "Claude Sonnet", providerId: "anthropic" },
      { id: "claude-haiku-4-5", name: "Claude Haiku", providerId: "anthropic" },
    ]),
    ["claude-haiku-4-5", "claude-sonnet-4-6"],
  )
  assert.deepEqual(
    repoIndexModelCandidates(baseConfig, [
      { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet", providerId: "openrouter" },
      { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku", providerId: "openrouter" },
    ]),
    ["anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-4.6"],
  )
  assert.deepEqual(
    repoIndexModelCandidates({ ...baseConfig, provider: "glm", model: "glm-5", providerConfig: { defaultModel: "glm-5" } }, [
      { id: "glm-5", name: "GLM 5", providerId: "glm" },
      { id: "glm-4", name: "GLM 4", providerId: "glm" },
      { id: "glm-4-air", name: "GLM 4 Air", providerId: "glm" },
      { id: "glm-4-flash", name: "GLM 4 Flash", providerId: "glm" },
    ]),
    ["glm-5", "glm-4-flash", "glm-4-air", "glm-4"],
  )

  assert.equal(
    selectRepoIndexModel(baseConfig, [
      { id: "gpt-4o-mini", name: "GPT 4o mini", providerId: "openai" },
      { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", providerId: "openrouter" },
    ]),
    "anthropic/claude-haiku-4.5",
  )
})
