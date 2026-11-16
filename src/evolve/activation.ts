import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { packageVersion } from "../version.js"

export type ActiveEvolveManifest = {
  cliPath: string
  sourceRoot: string
  version: 1
  packageVersion: string
}

export function activeEvolveManifestPath(): string {
  return join(homedir(), ".codesh", "evolve", "active.json")
}

export function activateManagedCodeshRoot(root: string): void {
  const sourceRoot = resolve(root)
  const cliPath = join(sourceRoot, "dist", "cli.js")
  if (!existsSync(cliPath)) throw new Error(`Evolved Codesh bundle is missing: ${cliPath}`)

  const path = activeEvolveManifestPath()
  const temp = `${path}.tmp-${process.pid}`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temp, `${JSON.stringify({
    cliPath,
    packageVersion,
    sourceRoot,
    version: 1,
  } satisfies ActiveEvolveManifest, null, 2)}\n`, "utf8")
  renameSync(temp, path)
}

export function isSelfUpdateInvocation(argv: string[] = process.argv): boolean {
  const args = argv.slice(2)
  if (args[0] === "update") return true
  return args.includes("--update")
}

export function resolveActiveEvolveCli(entry = process.argv[1]): string | undefined {
  if (!entry || process.env.CODESH_DISABLE_EVOLVE_RELAUNCH === "1") return undefined
  if (isSelfUpdateInvocation()) return undefined

  const resolvedEntry = safeRealpath(entry)
  // Development and managed-source bundles already live beside src/. Only a
  // source-less published installation should hand off to the active bundle.
  if (!isPublishedCodeshEntry(resolvedEntry)) return undefined

  try {
    const manifest = readActiveEvolveManifest()
    if (!manifest || manifest.packageVersion !== packageVersion) return undefined
    const target = safeRealpath(manifest.cliPath)
    if (!existsSync(target) || target === resolvedEntry) return undefined
    return target
  } catch {
    return undefined
  }
}

export function readActiveEvolveManifest(): ActiveEvolveManifest | undefined {
  try {
    const manifest = JSON.parse(readFileSync(activeEvolveManifestPath(), "utf8")) as Partial<ActiveEvolveManifest>
    if (
      manifest.version !== 1
      || typeof manifest.cliPath !== "string"
      || typeof manifest.sourceRoot !== "string"
      || typeof manifest.packageVersion !== "string"
    ) return undefined
    return manifest as ActiveEvolveManifest
  } catch {
    return undefined
  }
}

export function isPublishedCodeshEntry(entry = process.argv[1]): boolean {
  if (!entry) return false
  const packageRoot = resolve(dirname(safeRealpath(entry)), "..")
  return !(
    existsSync(join(packageRoot, "src", "cli.ts"))
    && existsSync(join(packageRoot, "src", "evolve", "orchestrator.ts"))
  )
}

export function relaunchActiveEvolveIfNeeded(): void {
  const target = resolveActiveEvolveCli()
  if (!target) return

  const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
    env: { ...process.env, CODESH_DISABLE_EVOLVE_RELAUNCH: "1" },
    stdio: "inherit",
  })
  if (result.error) {
    process.stderr.write(`Could not launch evolved Codesh: ${result.error.message}\n`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

export function clearActiveEvolve(): void {
  rmSync(activeEvolveManifestPath(), { force: true })
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
