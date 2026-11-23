import assert from "node:assert/strict"
import test from "node:test"

const {
  codeshRelease,
  codeshReleases,
  unacknowledgedCodeshRelease,
  validateReleaseManifest,
} = await import("../dist/release-notes.js")
const { packageVersion } = await import("../dist/version.js")

test("release manifest is complete, unique, and newest-first", () => {
  const releases = codeshReleases()
  assert.deepEqual(validateReleaseManifest(), [])
  assert.equal(releases[0]?.version, packageVersion)
  assert.equal(releases.at(-1)?.version, "0.1.0")
  assert.equal(releases.some((release) => release.version === "0.1.23" && release.status === "tagged"), true)
})

test("current package version always has local release notes", () => {
  const release = codeshRelease(packageVersion)
  assert.ok(release)
  assert.equal(release.version, packageVersion)
  assert.ok(release.summary.length > 0)
  assert.ok(release.changes.length > 0)
})

test("What’s New is selected only for an unacknowledged installed version", () => {
  assert.equal(unacknowledgedCodeshRelease(packageVersion, [])?.version, packageVersion)
  assert.equal(unacknowledgedCodeshRelease(packageVersion, [packageVersion]), undefined)
  assert.equal(unacknowledgedCodeshRelease("0.2.7", []), undefined)
  assert.equal(unacknowledgedCodeshRelease("9.9.9", []), undefined)
})
