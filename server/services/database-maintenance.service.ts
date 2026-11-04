import Database from "better-sqlite3"
import { chmod, lstat, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import type { OpenCodeClient } from "@opencode/client"
import { getAllSessions, getDatabaseFootprintAt, getDatabasePath } from "../data/session-repository.js"
import { OpenCodeClientService } from "./opencode-client.service.js"

export type CompactionProgressState = "idle" | "running" | "completed" | "failed" | "blocked"

export interface DatabaseCompactionProgress {
  state: CompactionProgressState
  stage: string
  message: string
  operationID?: string
  updatedAt?: number
  backupID?: string
  error?: string
  result?: DatabaseCompactionResult
}

export interface DatabaseBackupInfo {
  id: string
  sizeBytes: number
  createdAt: number
  verified: boolean
  beforeBytes?: number
  afterBytes?: number
  verifiedConversationCount?: number
}

export type DatabaseCompactionResult =
  | { kind: "active-sessions"; activeSessions: number }
  | {
    kind: "compacted"
    beforeBytes: number
    afterBytes: number
    bytesReclaimed: number
    beforeConversations: number
    afterConversations: number
    backupID: string
    backupPath: string
  }

export interface DatabaseMaintenanceClientProvider {
  getClient(startService?: boolean): Promise<OpenCodeClient | undefined>
  stopForMaintenance(): Promise<void>
  restartAfterMaintenance(): Promise<{ version: string }>
}

type DatabasePathResolver = () => Promise<string>
type FootprintReader = typeof getDatabaseFootprintAt

interface BackupManifest {
  verified: true
  verifiedAt: string
  beforeBytes: number
  afterBytes: number
  beforeConversations: number
  afterConversations: number
}

export class DatabaseMaintenanceService {
  private progress: DatabaseCompactionProgress = {
    state: "idle",
    stage: "idle",
    message: "No database maintenance has run in this app session.",
  }

  constructor(
    private readonly clientService: DatabaseMaintenanceClientProvider,
    private readonly resolvePath: DatabasePathResolver = getDatabasePath,
    private readonly readFootprint: FootprintReader = getDatabaseFootprintAt,
    private readonly backupDirectory = join(homedir(), ".local", "share", "opencode-session-keeper", "backups"),
  ) {}

  getProgress(operationID?: string): DatabaseCompactionProgress {
    if (operationID && this.progress.operationID !== operationID) {
      return { state: "idle", stage: "waiting", message: "Waiting for database maintenance to start…", operationID }
    }
    return { ...this.progress }
  }

  async listBackups(): Promise<DatabaseBackupInfo[]> {
    let entries
    try {
      entries = await readdir(this.backupDirectory, { withFileTypes: true })
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }

    const backups: DatabaseBackupInfo[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".backup")) continue
      const backupPath = join(this.backupDirectory, entry.name)
      const file = await stat(backupPath)
      const manifest = await this.readBackupManifest(backupPath)
      backups.push({
        id: entry.name,
        sizeBytes: file.size,
        createdAt: file.mtimeMs,
        verified: Boolean(manifest?.verified),
        beforeBytes: manifest?.beforeBytes,
        afterBytes: manifest?.afterBytes,
        verifiedConversationCount: manifest?.afterConversations,
      })
    }
    return backups.sort((a, b) => b.createdAt - a.createdAt)
  }

  async deleteVerifiedBackup(backupID: string): Promise<void> {
    if (this.progress.state === "running") throw new Error("Cannot delete backups while database maintenance is running.")
    const backupPath = this.backupPathForID(backupID)
    const file = await lstat(backupPath)
    if (!file.isFile() || file.isSymbolicLink()) throw new Error("Backup file not found.")
    const manifest = await this.readBackupManifest(backupPath)
    if (!manifest?.verified) throw new Error("Only a verified database backup can be deleted from the app.")
    await unlink(backupPath)
    await unlink(this.manifestPath(backupPath)).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error
    })
  }

  async compactDatabase(operationID: string): Promise<DatabaseCompactionResult> {
    if (this.progress.state === "running") throw new Error("Database compaction is already running.")
    this.setProgress("running", "checking-active-sessions", "Checking for active OpenCode sessions…", undefined, undefined, undefined, operationID)
    await this.yieldForProgress()

    const client = await this.requireClient()
    const activeSessions = Object.keys(await client.session.active()).length
    if (activeSessions > 0) {
      this.setProgress("blocked", "blocked", `${activeSessions} OpenCode session${activeSessions === 1 ? " is" : "s are"} active.`, undefined, undefined, undefined, operationID)
      return { kind: "active-sessions", activeSessions }
    }

    await this.report("locating-database", "Locating the OpenCode database…", 100)
    const databasePath = await this.resolvePath()
    const before = await this.readFootprint(databasePath)
    if (!before.available || before.databaseBytes === null || before.totalBytes === null) {
      throw new Error("OpenCode database file was not found or could not be measured.")
    }
    await this.report("counting-conversations", "Checking that conversations are preserved…", 100)
    const beforeConversations = (await getAllSessions(client, { archived: "all" })).length
    const backupPath = await this.createBackupPath(databasePath)
    const backupID = basename(backupPath)
    let serviceStopped = false

    try {
      await this.report("stopping-service", "Stopping the shared OpenCode service…")
      await this.clientService.stopForMaintenance()
      serviceStopped = true

      await this.vacuumWithBackup(databasePath, backupPath)

      await this.report("restarting-service", "Restarting OpenCode…")
      await this.clientService.restartAfterMaintenance()
      serviceStopped = false

      await this.report("verifying", "Checking OpenCode and verifying conversations…")
      const restartedClient = await this.requireClient()
      await restartedClient.server.info()
      const afterConversations = (await getAllSessions(restartedClient, { archived: "all" })).length
      if (afterConversations !== beforeConversations) {
        throw new Error(`Conversation count changed during compaction (${beforeConversations} before, ${afterConversations} after). Backup kept for review.`)
      }

      const after = await this.readFootprint(databasePath)
      if (after.totalBytes === null) throw new Error("Compacted database size could not be read.")
      await this.markBackupVerified(backupPath, {
        verified: true,
        verifiedAt: new Date().toISOString(),
        beforeBytes: before.totalBytes,
        afterBytes: after.totalBytes,
        beforeConversations,
        afterConversations,
      })

      const result: DatabaseCompactionResult = {
        kind: "compacted",
        beforeBytes: before.totalBytes,
        afterBytes: after.totalBytes,
        bytesReclaimed: Math.max(0, before.totalBytes - after.totalBytes),
        beforeConversations,
        afterConversations,
        backupID,
        backupPath,
      }
      this.setProgress("completed", "completed", "Database compaction and OpenCode verification complete.", backupID, undefined, result, operationID)
      return result
    } catch (error) {
      const failedStage = this.progress.stage
      let restartError: unknown
      if (serviceStopped) {
        await this.report("restarting-service", "Compaction failed; restarting OpenCode…")
        try {
          await this.clientService.restartAfterMaintenance()
        } catch (restartFailure) {
          restartError = restartFailure
        }
      }
      const backupExists = await stat(backupPath).then(() => true).catch(() => false)
      const backupMessage = backupExists ? `Backup retained at ${backupPath}.` : "No backup was created."
      const message = `Database compaction failed. ${errorMessage(error)} ${backupMessage}${restartError ? ` OpenCode also failed to restart: ${errorMessage(restartError)}` : ""}`
      this.setProgress("failed", failedStage, message, backupExists ? backupID : undefined, message, undefined, operationID)
      throw new Error(message)
    }
  }

  private async createBackupPath(databasePath: string): Promise<string> {
    await mkdir(this.backupDirectory, { recursive: true, mode: 0o700 })
    await chmod(this.backupDirectory, 0o700)
    const backupName = `${basename(databasePath)}.${new Date().toISOString().replaceAll(/[:.]/g, "-")}.${randomUUID().slice(0, 8)}.backup`
    return join(this.backupDirectory, backupName)
  }

  private async vacuumWithBackup(databasePath: string, backupPath: string): Promise<void> {
    const database = new Database(databasePath, { fileMustExist: true, timeout: 10_000 })
    try {
      await this.report("checking-integrity", "Checking database integrity before compaction…", 100)
      this.assertDatabaseIntegrity(database)
      await this.report("creating-backup", "Creating a private database backup…", 150)
      await database.backup(backupPath)
      await chmod(backupPath, 0o600)
      await this.report("compacting", "Rebuilding SQLite pages. This can take a while…", 350)
      database.exec("VACUUM")
      await this.report("verifying-database", "Checking the compacted database…", 100)
      this.assertDatabaseIntegrity(database)
    } finally {
      database.close()
    }
    await stat(backupPath)
  }

  private assertDatabaseIntegrity(database: Database.Database): void {
    const result = database.pragma("integrity_check", { simple: true })
    if (result !== "ok") throw new Error(`SQLite integrity check failed: ${String(result)}`)
  }

  private async requireClient(): Promise<OpenCodeClient> {
    const client = await this.clientService.getClient()
    if (!client) throw new Error("Connect to OpenCode before compacting its database.")
    return client
  }

  private async report(stage: string, message: string, delayMs = 0): Promise<void> {
    this.setProgress("running", stage, message, undefined, undefined, undefined, this.progress.operationID)
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  private async yieldForProgress(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  private setProgress(
    state: DatabaseCompactionProgress["state"],
    stage: string,
    message: string,
    backupID?: string,
    error?: string,
    result?: DatabaseCompactionResult,
    operationID?: string,
  ): void {
    this.progress = { state, stage, message, updatedAt: Date.now(), backupID, error, result, operationID }
  }

  private async readBackupManifest(backupPath: string): Promise<BackupManifest | undefined> {
    try {
      return JSON.parse(await readFile(this.manifestPath(backupPath), "utf8")) as BackupManifest
    } catch {
      return undefined
    }
  }

  private async markBackupVerified(backupPath: string, manifest: BackupManifest): Promise<void> {
    const manifestPath = this.manifestPath(backupPath)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 })
    await chmod(manifestPath, 0o600)
  }

  private manifestPath(backupPath: string): string {
    return `${backupPath}.json`
  }

  private backupPathForID(backupID: string): string {
    if (basename(backupID) !== backupID || !backupID.endsWith(".backup")) {
      throw new Error("Invalid database backup ID.")
    }
    const directory = resolve(this.backupDirectory)
    const backupPath = resolve(directory, backupID)
    if (!backupPath.startsWith(`${directory}${sep}`)) throw new Error("Invalid database backup path.")
    return backupPath
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database compaction error."
}
