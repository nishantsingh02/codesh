#!/usr/bin/env node

const minimum = "22.19.0"
const current = process.versions.node

function versionParts(version) {
  return version.split(".").map(Number)
}

const currentParts = versionParts(current)
const minimumParts = versionParts(minimum)

const isTooOld = currentParts[0] < minimumParts[0]
  || (currentParts[0] === minimumParts[0] && currentParts[1] < minimumParts[1])
  || (currentParts[0] === minimumParts[0] && currentParts[1] === minimumParts[1] && currentParts[2] < minimumParts[2])

if (isTooOld) {
  const versionManagerHint = process.platform === "win32"
    ? "  Install a newer Node with nvm-windows, Volta, or the Node.js installer."
    : "  Run `nvm use` (or select a newer Node with your version manager)."
  console.error([
    `Codesh requires Node ${minimum} or newer for native better-sqlite3 compatibility.`,
    `Current Node: ${current} (${process.execPath})`,
    "",
    "Fix:",
    versionManagerHint,
    "  npm rebuild better-sqlite3",
    "",
    "Then retry your npm command.",
  ].join("\n"))
  process.exit(1)
}
