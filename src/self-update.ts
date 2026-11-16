import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { installManagedCodesh, type ManagedInstallOptions, type ManagedInstallResult } from "./managed-install.js"

const PACKAGE_SPEC = "codesh@latest"

export type SelfUpdateOptions = {
  env?: NodeJS.ProcessEnv
  install?: (options: ManagedInstallOptions) => ManagedInstallResult
  packageRoot?: string
  platform?: NodeJS.Platform
  spawn?: ManagedInstallOptions["spawn"]
  stderr?: (message: string) => void
  stdout?: (message: string) => void
}

export function codeshPackageRoot(moduleUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "..")
}

export function isSourceCheckout(packageRoot: string): boolean {
  return existsSync(resolve(packageRoot, ".git")) || existsSync(resolve(packageRoot, "tsconfig.json"))
}

export function runSelfUpdate(options: SelfUpdateOptions = {}): boolean {
  const packageRoot = options.packageRoot ?? codeshPackageRoot()
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message))
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message))

  if (isSourceCheckout(packageRoot)) {
    stderr(
      "Codesh is running from a source checkout, so self-update was not run.\n" +
      "Update this checkout with Git, then run `npm install` and `npm run build`.\n",
    )
    return false
  }

  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const install = options.install ?? installManagedCodesh

  stdout(`Updating Codesh to the latest published version...\n`)
  let result: ManagedInstallResult
  try {
    result = install({
      env,
      packageSpec: PACKAGE_SPEC,
      platform,
      root: env.CODESH_MANAGED_ROOT,
      spawn: options.spawn,
      stdout,
    })
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ""
    stderr(`Codesh update failed${detail}.\n`)
    return false
  }

  stdout(
    `Codesh ${result.version} is installed. Restart it to use the update.\n` +
    (result.pathChanged ? "Reopen your terminal so the `codesh` command is available on PATH.\n" : "") +
    "Any Evolve changes will be reapplied on the next launch; follow the prompts if you have Evolve changes.\n" +
    "View the latest changelog with `/change` or at https://github.com/nishantsingh211/codesh/blob/main/CHANGELOG.md.\n",
  )
  return true
}
