import assert from "node:assert/strict"
import test from "node:test"

const { createRepoIndexService, selectBackgroundIndexModel } = await import("../../dist/repo-index/service.js")

function config(policy = "every-git-push") {
  return {
    apiKey: "test-key",
    appName: "Codesh",
    model: "anthropic/claude-haiku-4.5",
    modelSettings: {},
    provider: "openrouter",
    providerConfig: {
      apiKey: "test-key",
      appName: "Codesh",
      baseUrl: "https://example.test",
      defaultModel: "anthropic/claude-haiku-4.5",
      displayName: "OpenRouter",
      id: "openrouter",
      protocol: "openai-compatible",
      siteUrl: "http://localhost",
    },
    repoIndexPolicy: policy,
    siteUrl: "http://localhost",
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test("background OpenAI indexing prefers the verified GPT-5 model ID", () => {
  const definition = {
    id: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai-compatible",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5",
  }
  assert.equal(selectBackgroundIndexModel(definition, []), "gpt-5")
  assert.equal(selectBackgroundIndexModel(definition, [
    { id: "gpt-4o-mini", name: "GPT 4o Mini", providerId: "openai" },
    { id: "gpt-5", name: "GPT 5", providerId: "openai" },
  ]), "gpt-5")
})

test("every-git-push reindexes in background when upstream changes and coalesces polls", async () => {
  let poll
  let upstreamOid = "a"
  let generated = 0
  let release
  const statuses = []
  const pendingGeneration = new Promise((resolve) => { release = resolve })
  const service = createRepoIndexService({
    config: config(),
    cwd: "/repo",
    generate: async () => {
      generated += 1
      await pendingGeneration
      return { content: "", model: "", path: "" }
    },
    getModels: async () => [],
    onStatus: (status) => statuses.push(status),
    probeGit: async () => ({
      headOid: upstreamOid,
      root: "/repo",
      upstreamOid,
      upstreamRef: "origin/main",
    }),
    readMeta: async () => ({
      fileCount: 1,
      generatedAt: "2026-07-14T00:00:00.000Z",
      gitHead: "a",
      indexedUpstreamOid: "a",
      indexedUpstreamRef: "origin/main",
      onboardingDecision: "accepted",
      packageName: "demo",
      version: 2,
    }),
    resolveBackgroundConfig: async (value) => value,
    setInterval: (callback) => {
      poll = callback
      return { unref() {} }
    },
    clearInterval: () => {},
    updateMeta: async () => {},
  })

  await flush()
  assert.equal(generated, 0)
  upstreamOid = "b"
  poll()
  poll()
  await flush()
  assert.equal(generated, 1)
  assert.equal(statuses.at(-1).state, "running")
  assert.equal(statuses.at(-1).message, "Reindexing repository after upstream change…")
  release()
  await flush()
  assert.equal(statuses.at(-1).state, "success")
  service.stop()
})

test("startup catches an upstream change missed while Codesh was closed", async () => {
  let generated = 0
  const service = createRepoIndexService({
    config: config(),
    cwd: "/repo",
    generate: async () => {
      generated += 1
      return { content: "", model: "", path: "" }
    },
    getModels: async () => [],
    onStatus: () => {},
    probeGit: async () => ({
      headOid: "new",
      root: "/repo",
      upstreamOid: "new",
      upstreamRef: "origin/main",
    }),
    readMeta: async () => ({
      fileCount: 1,
      generatedAt: "2026-07-14T00:00:00.000Z",
      gitHead: "old",
      indexedUpstreamOid: "old",
      indexedUpstreamRef: "origin/main",
      onboardingDecision: "accepted",
      packageName: "demo",
      version: 2,
    }),
    resolveBackgroundConfig: async (value) => value,
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    updateMeta: async () => {},
  })
  await flush()
  assert.equal(generated, 1)
  service.stop()
})

test("agent-decides does not poll or automatically regenerate", async () => {
  let intervals = 0
  let generated = 0
  const service = createRepoIndexService({
    config: config("agent-decides"),
    cwd: "/repo",
    generate: async () => {
      generated += 1
      return { content: "", model: "", path: "" }
    },
    getModels: async () => [],
    onStatus: () => {},
    probeGit: async () => null,
    readMeta: async () => null,
    setInterval: () => {
      intervals += 1
      return { unref() {} }
    },
    clearInterval: () => {},
    updateMeta: async () => {},
  })
  await flush()
  assert.equal(intervals, 0)
  assert.equal(generated, 0)
  const manualRun = service.request("manual")
  await flush()
  assert.equal(await manualRun, true)
  assert.equal(generated, 1)
  service.stop()
})
