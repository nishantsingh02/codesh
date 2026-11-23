import assert from "node:assert/strict"
import test from "node:test"

const {
  CLEAR_INSTALLER_OUTPUT,
  renderInstallCompletion,
  waitForInstallContinue,
} = await import("../dist/install-onboarding.js")

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "")
}

test("installer completion highlights the command and tips without unnecessary restart copy", () => {
  const message = stripAnsi(renderInstallCompletion({
    launcherPath: "/home/user/.local/bin/codesh",
    pathChanged: false,
    root: "/home/user/.local/share/codesh",
    version: "1.2.3",
  }))

  assert.match(message, /Codesh 1\.2\.3 installed/)
  assert.match(message, /persistent command is codesh/)
  assert.match(message, /\/settings/)
  assert.match(message, /\/tips/)
  assert.doesNotMatch(message, /Restart your terminal/)
})

test("installer completion shows restart guidance only after PATH changes", () => {
  const message = stripAnsi(renderInstallCompletion({
    launcherPath: "C:\\Users\\Nishant\\AppData\\Local\\Codesh\\bin\\codesh.cmd",
    pathChanged: true,
    root: "C:\\Users\\Nishant\\AppData\\Local\\Codesh",
    version: "1.2.3",
  }))

  assert.match(message, /Restart your terminal once/)
  assert.match(message, /running `codesh` next time/)
})

test("non-interactive installation never blocks waiting for Enter", async () => {
  let output = ""
  const continued = await waitForInstallContinue(
    { isTTY: false },
    { isTTY: false, write: (value) => { output += value } },
  )

  assert.equal(continued, false)
  assert.equal(output, "")
  assert.match(CLEAR_INSTALLER_OUTPUT, /\x1b\[3J/)
})
