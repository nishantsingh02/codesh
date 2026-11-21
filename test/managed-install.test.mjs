import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

const {
  bootstrapFromNpx,
  installManagedCodesh,
  managedInstallPaths,
  renderManagedInstallBanner,
  renderManagedLauncher,
  shouldBootstrapFromNpx,
  windowsUserPathScript,
} = await import("../dist/managed-install.js")

test("managed install uses a versioned user directory and persistent Unix launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "codesh-managed-"))
  const home = join(root, "home")
  const installRoot = join(root, "install")
  await mkdir(home, { recursive: true })
  let invocation
  let output = ""

  try {
    const result = installManagedCodesh({
      env: { HOME: home, PATH: "/usr/bin", SHELL: "/bin/bash" },
      homeDir: home,
      packageSpec: "codesh@9.8.7",
      platform: "linux",
      root: installRoot,
      showBanner: true,
      spawn: (command, args, options) => {
        invocation = { args, command, options }
        const prefix = args[args.indexOf("--prefix") + 1]
        const packageRoot = join(prefix, "node_modules", "codesh")
        mkdirSync(join(packageRoot, "dist"), { recursive: true })
        writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version: "9.8.7" }))
        writeFileSync(join(packageRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
        return { status: 0 }
      },
      stdout: (message) => { output += message },
    })

    assert.equal(result.version, "9.8.7")
    assert.equal(result.pathChanged, true)
    assert.equal(invocation.command, "npm")
    assert.deepEqual(invocation.args.slice(0, 3), ["install", "--prefix", invocation.args[2]])
    assert.match(await readFile(result.launcherPath, "utf8"), /CODESH_MANAGED_INSTALL=1/)
    assert.match(await readFile(result.launcherPath, "utf8"), /versions\/9\.8\.7/)
    assert.match(await readFile(join(home, ".bashrc"), "utf8"), /\.local\/bin/)
    assert.match(output, /Preparing your Codesh installation/)
    assert.match(output, /Codesh is ready/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("Windows paths and launcher use LOCALAPPDATA without administrator directories", () => {
  const paths = managedInstallPaths({
    env: { LOCALAPPDATA: "C:\\Users\\Nishant Singh\\AppData\\Local" },
    homeDir: "C:\\Users\\Nishant Singh",
    platform: "win32",
  })
  const launcher = renderManagedLauncher({
    cliPath: "C:\\Users\\Nishant Singh\\AppData\\Local\\Codesh\\versions\\1.2.3\\node_modules\\codesh\\dist\\cli.js",
    platform: "win32",
    root: paths.root,
  })
  const pathScript = windowsUserPathScript(paths.binDir)

  assert.equal(paths.launcherPath, "C:\\Users\\Nishant Singh\\AppData\\Local\\Codesh\\bin\\codesh.cmd")
  assert.notEqual(paths.root, "C:\\Users\\Nishant Singh\\.codesh")
  assert.match(launcher, /set "CODESH_MANAGED_INSTALL=1"/)
  assert.match(launcher, /node "C:\\Users\\Nishant Singh\\AppData\\Local\\Codesh\\versions/)
  assert.match(launcher, /%\*/)
  assert.match(pathScript, /SetEnvironmentVariable\('Path'/)
  assert.match(pathScript, /Nishant Singh/)
  assert.doesNotMatch(paths.root, /Program Files/i)
})

test("npx setup banner identifies Codesh without touching user-state paths", () => {
  const banner = renderManagedInstallBanner()
  const paths = managedInstallPaths({
    env: { HOME: "/home/nishant" },
    homeDir: "/home/nishant",
    platform: "linux",
  })

  assert.match(banner, /██/)
  assert.match(banner, /CODESH|███████/)
  assert.equal(paths.root, "/home/nishant/.local/share/codesh")
  assert.notEqual(paths.root, "/home/nishant/.codesh")
})

test("npx detection skips source and already-managed launches", () => {
  assert.equal(shouldBootstrapFromNpx({
    env: { npm_command: "exec" },
    packageRoot: "/tmp/npm-cache/_npx/abc/node_modules/codesh",
  }), true)
  assert.equal(shouldBootstrapFromNpx({
    env: { CODESH_MANAGED_INSTALL: "1", npm_command: "exec" },
    packageRoot: "/tmp/npm-cache/_npx/abc/node_modules/codesh",
  }), false)
  assert.equal(shouldBootstrapFromNpx({
    env: {},
    packageRoot: process.cwd(),
  }), false)
})

test("bootstrap is idempotent when the managed launcher already exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "codesh-bootstrap-"))
  const home = join(root, "home")
  const installRoot = join(root, "install")
  const paths = managedInstallPaths({ homeDir: home, platform: "linux", root: installRoot })
  await mkdir(paths.binDir, { recursive: true })
  await writeFile(paths.launcherPath, "#!/bin/sh\n")
  const expectedCli = join(paths.versionsDir, "1.2.3", "node_modules", "codesh", "dist", "cli.js")
  await mkdir(dirname(expectedCli), { recursive: true })
  await writeFile(expectedCli, "#!/usr/bin/env node\n")

  try {
    const result = bootstrapFromNpx({
      env: { HOME: home, PATH: `${paths.binDir}:/usr/bin`, npm_command: "exec" },
      homeDir: home,
      packageRoot: "/tmp/npm-cache/_npx/abc/node_modules/codesh",
      platform: "linux",
      root: installRoot,
      spawn: () => {
        throw new Error("should not install twice")
      },
      version: "1.2.3",
    })
    assert.equal(result, undefined)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("failed managed installs surface an actionable error", async () => {
  const root = await mkdtemp(join(tmpdir(), "codesh-failed-install-"))
  assert.throws(() => installManagedCodesh({
    env: { HOME: root, PATH: "/usr/bin" },
    homeDir: root,
    packageSpec: "codesh@latest",
    platform: "linux",
    root: join(root, "install"),
    spawn: () => ({ status: 1 }),
  }), /npm installation failed/)
  await rm(root, { force: true, recursive: true })
})
