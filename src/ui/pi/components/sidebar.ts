/**
 * Ported and adapted from OpenCode's chat sidebar
 * (internal/tui/components/chat/sidebar.go and chat.go).
 *
 * Provides a clean terminal sidebar tracking:
 *  1. Header (Logo, repo, and cwd)
 *  2. Current session info
 *  3. LSP / Tool configurations
 *  4. Modified files with real-time (+additions / -removals) diff stats
 */
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { relative } from "node:path"
import { theme } from "../theme.js"

export interface ModifiedFileStats {
  additions: number
  removals: number
}

export interface SidebarLspEntry {
  command?: string
  name: string
  status?: "ready" | "active" | "error"
}

export interface SidebarOptions {
  appName?: string
  cwd?: string
  lsps?: SidebarLspEntry[]
  repo?: string
  sessionTitle?: string
  version?: string
}

export class SidebarComponent implements Component {
  private appName: string
  private cwd: string
  private lsps: SidebarLspEntry[]
  private modifiedFilesMap = new Map<string, ModifiedFileStats>()
  private repo?: string
  private sessionTitle: string
  private version: string

  constructor(options?: SidebarOptions) {
    this.appName = options?.appName ?? "Codesh"
    this.version = options?.version ?? "0.2.32"
    this.cwd = options?.cwd ?? process.cwd()
    this.repo = options?.repo
    this.sessionTitle = options?.sessionTitle ?? "New Session"
    this.lsps = options?.lsps ?? [
      { name: "TypeScript", command: "tsserver", status: "ready" },
      { name: "Repository Index", command: "repo-index", status: "active" },
    ]
  }

  setSessionTitle(title: string): void {
    this.sessionTitle = title
  }

  setCwd(cwd: string): void {
    this.cwd = cwd
  }

  setRepo(repo?: string): void {
    this.repo = repo
  }

  setLsps(lsps: SidebarLspEntry[]): void {
    this.lsps = [...lsps]
  }

  /**
   * Record or update modified file statistics (+additions, -removals).
   */
  setModifiedFile(filePath: string, additions: number, removals: number): void {
    const displayPath = this.getDisplayPath(filePath)
    if (additions === 0 && removals === 0) {
      this.modifiedFilesMap.delete(displayPath)
    } else {
      this.modifiedFilesMap.set(displayPath, { additions, removals })
    }
  }

  removeModifiedFile(filePath: string): void {
    const displayPath = this.getDisplayPath(filePath)
    this.modifiedFilesMap.delete(displayPath)
  }

  clearModifiedFiles(): void {
    this.modifiedFilesMap.clear()
  }

  getModifiedFiles(): Map<string, ModifiedFileStats> {
    return new Map(this.modifiedFilesMap)
  }

  invalidate(): void {
    // No-op for pi-tui lifecycle
  }

  private getDisplayPath(filePath: string): string {
    if (!filePath) return ""
    try {
      const rel = relative(this.cwd, filePath)
      if (rel && !rel.startsWith("..")) {
        return rel.replace(/\\/g, "/")
      }
    } catch {
      // Fallback to verbatim
    }
    return filePath.replace(/\\/g, "/")
  }

  private renderHeader(width: number): string[] {
    const lines: string[] = []

    // 1. Logo and version
    const logoTitle = `${theme.bold(theme.fg("accent", "✦ " + this.appName))} ${theme.fg("dim", `v${this.version}`)}`
    lines.push(truncateToWidth(logoTitle, width, "…"))

    // 2. Repo line if available
    if (this.repo) {
      lines.push(truncateToWidth(theme.fg("muted", this.repo), width, "…"))
    }

    // 3. Current working directory
    const cwdDisplay = `cwd: ${this.cwd}`
    lines.push(truncateToWidth(theme.fg("dim", cwdDisplay), width, "…"))

    return lines
  }

  private renderSession(width: number): string[] {
    const sessionKey = theme.bold(theme.fg("accent", "Session"))
    const keyWidth = visibleWidth(sessionKey)
    const availableValWidth = Math.max(0, width - keyWidth - 2)
    const sessionVal = truncateToWidth(`: ${this.sessionTitle}`, availableValWidth, "…")
    return [`${sessionKey}${theme.fg("text", sessionVal)}`]
  }

  private renderLsps(width: number): string[] {
    const lines: string[] = []
    lines.push(theme.bold(theme.fg("accent", "LSP Configuration:")))

    if (!this.lsps || this.lsps.length === 0) {
      lines.push(`  ${theme.fg("dim", "No active language servers")}`)
      return lines
    }

    const sorted = [...this.lsps].sort((a, b) => a.name.localeCompare(b.name))
    for (const lsp of sorted) {
      const bullet = lsp.status === "error"
        ? theme.fg("error", "●")
        : lsp.status === "active"
          ? theme.fg("success", "●")
          : theme.fg("dim", "●")

      const name = theme.fg("text", lsp.name)
      const cmd = lsp.command ? theme.fg("dim", ` (${lsp.command})`) : ""
      const full = `  ${bullet} ${name}${cmd}`
      lines.push(truncateToWidth(full, width, "…"))
    }

    return lines
  }

  private renderModifiedFile(path: string, stats: ModifiedFileStats, width: number): string {
    let statsStr = ""
    if (stats.additions > 0 && stats.removals > 0) {
      statsStr = ` ${theme.fg("success", `+${stats.additions}`)} ${theme.fg("error", `-${stats.removals}`)}`
    } else if (stats.additions > 0) {
      statsStr = ` ${theme.fg("success", `+${stats.additions}`)}`
    } else if (stats.removals > 0) {
      statsStr = ` ${theme.fg("error", `-${stats.removals}`)}`
    }

    const statsLen = visibleWidth(statsStr)
    const availablePathWidth = Math.max(1, width - statsLen - 2)
    const clippedPath = truncateToWidth(path, availablePathWidth, "…")
    const gap = Math.max(1, width - visibleWidth(clippedPath) - statsLen - 2)

    return `  ${theme.fg("text", clippedPath)}${" ".repeat(gap)}${statsStr}`
  }

  private renderModifiedFiles(width: number): string[] {
    const lines: string[] = []
    lines.push(theme.bold(theme.fg("accent", "Modified Files:")))

    if (this.modifiedFilesMap.size === 0) {
      lines.push(`  ${theme.fg("muted", "No modified files")}`)
      return lines
    }

    const sortedPaths = Array.from(this.modifiedFilesMap.keys()).sort()
    for (const path of sortedPaths) {
      const stats = this.modifiedFilesMap.get(path)!
      lines.push(this.renderModifiedFile(path, stats, width))
    }

    return lines
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 2)
    const result: string[] = [
      "",
      ...this.renderHeader(innerWidth),
      "",
      ...this.renderSession(innerWidth),
      "",
      ...this.renderLsps(innerWidth),
      "",
      ...this.renderModifiedFiles(innerWidth),
      "",
    ]

    return result
  }
}
