import { stat } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { resolve } from "node:path"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"

// Shared read-only access to session records and local database metadata.
export type ArchiveFilter = "all" | "true" | "false"
const execFileAsync = promisify(execFile)
let databasePathPromise: Promise<string> | undefined

export async function listAllSessions(
  api: OpenCodeClient,
  options: { archived?: boolean; project?: string; search?: string } = {},
): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = []
  let cursor: string | undefined
  do {
    const page = await api.session.list({ limit: 100, order: "desc", cursor, ...options })
    sessions.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)
  return sessions
}

export async function getAllSessions(
  api: OpenCodeClient,
  options: { archived: ArchiveFilter; project?: string; search?: string },
): Promise<SessionInfo[]> {
  const archivedOptions = options.archived === "all" ? [false, true] : [options.archived === "true"]
  const pages = await Promise.all(archivedOptions.map((archived) => listAllSessions(api, {
    archived,
    project: options.project || undefined,
    search: options.search || undefined,
  })))
  const unique = new Map<string, SessionInfo>()
  for (const session of pages.flat()) unique.set(session.id, session)
  return [...unique.values()].sort((a, b) => b.time.updated - a.time.updated)
}

export async function getDatabaseFootprint(databasePath?: string) {
  try {
    return await getDatabaseFootprintAt(databasePath ?? await getDatabasePath())
  } catch {
    return {
      available: false,
      databaseBytes: null,
      walBytes: 0,
      totalBytes: null,
      source: process.env.OPENCODE_DB ? "OPENCODE_DB" : "OpenCode database path unavailable",
    }
  }
}

export async function getDatabaseFootprintAt(databasePath: string) {
  const [database, wal] = await Promise.all([
    stat(databasePath).then((value) => value.size).catch(() => null),
    stat(`${databasePath}-wal`).then((value) => value.size).catch(() => 0),
  ])
  return {
    available: database !== null,
    databaseBytes: database,
    walBytes: wal,
    totalBytes: database === null ? null : database + wal,
    source: process.env.OPENCODE_DB ? "OPENCODE_DB" : "OpenCode database path",
  }
}

export function getDatabasePath(): Promise<string> {
  const override = process.env.OPENCODE_DB?.trim()
  if (override) {
    if (override === ":memory:") return Promise.reject(new Error("OpenCode does not have a file-backed database path."))
    return Promise.resolve(resolve(override))
  }
  if (!databasePathPromise) {
    // npm installs a .cmd launcher on Windows, which requires the command shell.
    // Keep the shell command constant; database overrides never enter the shell.
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "opencode"
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "opencode debug paths db"]
      : ["debug", "paths", "db"]
    databasePathPromise = execFileAsync(command, args, {
      encoding: "utf8",
      timeout: 5000,
    }).then(({ stdout }) => {
      const path = String(stdout).trim()
      if (!path || path === ":memory:") throw new Error("OpenCode does not have a file-backed database path.")
      return resolve(path)
    }).catch((error: unknown) => {
      databasePathPromise = undefined
      throw error
    })
  }
  return databasePathPromise
}

export function descendantsOf(sessionID: string, sessions: SessionInfo[]): SessionInfo[] {
  const childrenByParent = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const children = childrenByParent.get(session.parentID) ?? []
    children.push(session)
    childrenByParent.set(session.parentID, children)
  }

  const descendants: SessionInfo[] = []
  const pending = [...(childrenByParent.get(sessionID) ?? [])]
  while (pending.length > 0) {
    const child = pending.pop()!
    descendants.push(child)
    pending.push(...(childrenByParent.get(child.id) ?? []))
  }
  return descendants
}
