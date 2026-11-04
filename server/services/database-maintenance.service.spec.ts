import Database from "better-sqlite3"
import type { OpenCodeClient } from "@opencode/client"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getDatabaseFootprintAt } from "../data/session-repository.js"
import { DatabaseMaintenanceClientProvider, DatabaseMaintenanceService } from "./database-maintenance.service.js"

describe("DatabaseMaintenanceService", () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "session-keeper-db-test-"))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it("releases the maintenance lock after an early connection failure", async () => {
    const provider = { ...createClientProvider({}, []), getClient: async () => undefined }
    const service = new DatabaseMaintenanceService(provider)
    await expect(service.compactDatabase("first")).rejects.toThrow("Connect to OpenCode")
    expect(service.getProgress().state).toBe("failed")
    await expect(service.compactDatabase("retry")).rejects.toThrow("Connect to OpenCode")
    expect(service.getProgress().operationID).toBe("retry")
  })

  it("releases the maintenance lock after database discovery fails", async () => {
    const service = new DatabaseMaintenanceService(createClientProvider({}, []), async () => { throw new Error("Missing database") })
    await expect(service.compactDatabase("first")).rejects.toThrow("Missing database")
    expect(service.getProgress().state).toBe("failed")
    await expect(service.compactDatabase("retry")).rejects.toThrow("Missing database")
  })

  it("backs up and compacts a database, then restarts OpenCode", async () => {
    const databasePath = join(temporaryDirectory, "opencode.db")
    const database = new Database(databasePath)
    database.exec("CREATE TABLE payload (value TEXT)")
    const insert = database.prepare("INSERT INTO payload (value) VALUES (?)")
    database.transaction(() => {
      for (let index = 0; index < 300; index += 1) insert.run("x".repeat(16_384))
    })()
    database.exec("DELETE FROM payload")
    database.close()

    const events: string[] = []
    const service = new DatabaseMaintenanceService(
      createClientProvider({}, events),
      async () => databasePath,
      getDatabaseFootprintAt,
      join(temporaryDirectory, "backups"),
    )
    const beforeBytes = (await stat(databasePath)).size
    const observedStages = new Set<string>()
    let maintenanceFinished = false
    const progressMonitor = (async () => {
      while (!maintenanceFinished) {
        observedStages.add(service.getProgress("operation-success").stage)
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    })()

    const result = await service.compactDatabase("operation-success")
    maintenanceFinished = true
    await progressMonitor

    expect(result.kind).toBe("compacted")
    if (result.kind !== "compacted") throw new Error("Expected a compaction result")
    expect(observedStages).toContain("compacting")
    expect(service.getProgress("operation-success").state).toBe("completed")
    expect(result.beforeBytes).toBe(beforeBytes)
    expect(result.afterBytes).toBeLessThan(beforeBytes)
    expect(result.bytesReclaimed).toBe(beforeBytes - result.afterBytes)
    expect(await stat(result.backupPath)).toBeTruthy()
    expect(events).toEqual(["stop", "restart"])

    const compacted = new Database(databasePath, { readonly: true, fileMustExist: true })
    expect(compacted.pragma("integrity_check", { simple: true })).toBe("ok")
    compacted.close()
    const backup = new Database(result.backupPath, { readonly: true, fileMustExist: true })
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok")
    backup.close()

    await expect(service.listBackups()).resolves.toMatchObject([{ id: result.backupID, verified: true }])
    await service.deleteVerifiedBackup(result.backupID)
    await expect(stat(result.backupPath)).rejects.toThrow()
  })

  it("refuses compaction when OpenCode reports active sessions", async () => {
    const stop = vi.fn(async () => undefined)
    const restart = vi.fn(async () => ({ version: "test" }))
    const resolvePath = vi.fn(async () => join(temporaryDirectory, "unused.db"))
    const service = new DatabaseMaintenanceService(
      createClientProvider({ ses_active: {} }, [], stop, restart),
      resolvePath,
      getDatabaseFootprintAt,
      temporaryDirectory,
    )

    const result = await service.compactDatabase("operation-active")

    expect(result).toEqual({ kind: "active-sessions", activeSessions: 1 })
    expect(stop).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    expect(resolvePath).not.toHaveBeenCalled()
  })

  it("restarts OpenCode and leaves the original file alone when SQLite rejects the database", async () => {
    const databasePath = join(temporaryDirectory, "invalid.db")
    const original = Buffer.from("not a sqlite database")
    await writeFile(databasePath, original)
    const events: string[] = []
    const service = new DatabaseMaintenanceService(
      createClientProvider({}, events),
      async () => databasePath,
      getDatabaseFootprintAt,
      join(temporaryDirectory, "backups"),
    )

    await expect(service.compactDatabase("operation-failure")).rejects.toThrow("Database compaction failed")

    expect(events).toEqual(["stop", "restart"])
    expect(await readFile(databasePath)).toEqual(original)
  })
})

function createClientProvider(
  active: Record<string, unknown>,
  events: string[],
  stop: () => Promise<void> = async () => { events.push("stop") },
  restart: () => Promise<{ version: string }> = async () => { events.push("restart"); return { version: "test" } },
): DatabaseMaintenanceClientProvider {
  const client = {
    session: {
      active: async () => active,
      list: async () => ({ data: [], cursor: { next: null } }),
    },
    server: { info: async () => ({ version: "test" }) },
  } as unknown as OpenCodeClient
  return {
    getClient: async () => client,
    stopForMaintenance: stop,
    restartAfterMaintenance: restart,
  }
}
