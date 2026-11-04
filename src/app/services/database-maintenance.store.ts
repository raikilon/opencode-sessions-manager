import { HttpErrorResponse, httpResource } from "@angular/common/http"
import { Injectable, computed, inject, signal } from "@angular/core"
import { DatabaseBackupInfo, DatabaseCompactionProgress, DatabaseCompactionResult } from "../models/session.models"
import { ConfirmationService } from "./confirmation.service"
import { SessionApiService } from "./session-api.service"
import { SessionDashboardStore } from "./session-dashboard.store"

const COMPACTION_STEPS = [
  { id: "checking-active-sessions", label: "Check for active conversations" },
  { id: "locating-database", label: "Locate the OpenCode database" },
  { id: "counting-conversations", label: "Record the conversation count" },
  { id: "stopping-service", label: "Stop the shared OpenCode service" },
  { id: "checking-integrity", label: "Check the current database" },
  { id: "creating-backup", label: "Create a private backup" },
  { id: "compacting", label: "Rebuild SQLite pages" },
  { id: "verifying-database", label: "Verify database integrity" },
  { id: "restarting-service", label: "Restart OpenCode" },
  { id: "verifying", label: "Verify conversations and connection" },
] as const

type StepState = "pending" | "active" | "done" | "failed"

@Injectable({ providedIn: "root" })
export class DatabaseMaintenanceStore {
  private readonly confirmation = inject(ConfirmationService)
  private readonly api = inject(SessionApiService)
  private readonly dashboard = inject(SessionDashboardStore)
  private readonly backupRefresh = signal(0)
  private readonly backupsResource = httpResource<DatabaseBackupInfo[]>(() => {
    if (!this.dashboard.connected()) return undefined
    return { url: "/api/database/backups", params: { refresh: this.backupRefresh() } }
  }, { defaultValue: [] })

  readonly compacting = signal(false)
  readonly progress = signal<DatabaseCompactionProgress>({ state: "idle", stage: "idle", message: "" })
  readonly error = signal("")
  readonly progressWarning = signal("")
  readonly deletingBackupID = signal<string | undefined>(undefined)
  readonly backups = computed(() => this.backupsResource.value())
  readonly steps = computed(() => {
    const progress = this.progress()
    const stage = progress.stage === "blocked" ? "checking-active-sessions" : progress.stage
    const activeIndex = COMPACTION_STEPS.findIndex((step) => step.id === stage)
    return COMPACTION_STEPS.map((step, index) => ({
      ...step,
      state: this.stepState(progress.state, index, activeIndex) as StepState,
    }))
  })

  private polling = false
  private lastHandledBackupID?: string

  resume(progress: DatabaseCompactionProgress | undefined): void {
    if (!progress) return
    this.progress.set(progress)
    if (progress.state === "running" && progress.operationID && !this.compacting()) {
      this.compacting.set(true)
      void this.pollProgress(progress.operationID)
    } else if ((progress.state === "failed" || progress.state === "blocked") && progress.error) {
      this.error.set(progress.error)
    }
  }

  async compactDatabase(): Promise<void> {
    if (this.compacting()) return
    const confirmed = await this.confirmation.confirm({
      title: "Compact database?",
      message: "Compaction will temporarily stop and restart the shared OpenCode service. Close other OpenCode clients first. A private backup will be kept.",
      confirmLabel: "Compact database",
    })
    if (!confirmed) return

    const operationID = globalThis.crypto.randomUUID()
    this.compacting.set(true)
    this.error.set("")
    this.progress.set({ state: "running", stage: "starting", message: "Starting database maintenance…", operationID })
    const progressPoller = this.pollProgress(operationID)
    try {
      const result = await this.api.compactDatabase(operationID)
      await this.finishCompaction(result)
    } catch (error) {
      this.error.set(this.errorMessage(error, "Database compaction failed."))
      await this.dashboard.refreshConnectionStatus()
    } finally {
      this.compacting.set(false)
      await progressPoller
    }
  }

  async deleteVerifiedBackup(backupID: string): Promise<void> {
    const backup = this.backups().find((item) => item.id === backupID)
    if (!backup?.verified) return
    if (!await this.confirmation.confirm({
      title: "Delete database backup?",
      message: `Permanently delete the verified database backup (${this.formatBytes(backup.sizeBytes)})? This backup will no longer be available for recovery. This cannot be undone.`,
      confirmLabel: "Delete backup",
      danger: true,
    })) return

    this.deletingBackupID.set(backupID)
    this.error.set("")
    try {
      await this.api.deleteDatabaseBackup(backupID)
      this.backupRefresh.update((value) => value + 1)
      this.dashboard.setNotice("Verified database backup deleted.")
    } catch (error) {
      this.error.set(this.errorMessage(error, "Unable to delete the database backup."))
    } finally {
      this.deletingBackupID.set(undefined)
    }
  }

  dismissError(): void {
    this.error.set("")
  }

  private stepState(progressState: DatabaseCompactionProgress["state"], index: number, activeIndex: number): StepState {
    if (progressState === "completed") return "done"
    if (progressState === "failed" || progressState === "blocked") {
      if (index < activeIndex) return "done"
      if (index === activeIndex) return "failed"
      return "pending"
    }
    if (activeIndex < 0) return "pending"
    if (index < activeIndex) return "done"
    if (index === activeIndex) return "active"
    return "pending"
  }

  private async pollProgress(operationID: string): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      while (this.compacting()) {
        let progress: DatabaseCompactionProgress
        try {
          progress = await this.api.getDatabaseCompactionProgress(operationID)
          this.progressWarning.set("")
        } catch {
          this.progressWarning.set("Unable to read progress. Maintenance may still be running; retrying…")
          await delay(1500)
          continue
        }
        this.progress.set(progress)
        if (progress.state === "completed" && progress.result) {
          await this.finishCompaction(progress.result)
          this.compacting.set(false)
          return
        }
        if (progress.state === "failed" || progress.state === "blocked") {
          this.error.set(progress.error || progress.message)
          this.compacting.set(false)
          await this.dashboard.refreshConnectionStatus()
          return
        }
        await delay(300)
      }
    } catch (error) {
      this.error.set(this.errorMessage(error, "Unable to read compaction progress."))
      this.compacting.set(false)
    } finally {
      this.polling = false
    }
  }

  private async finishCompaction(result: DatabaseCompactionResult): Promise<void> {
    if (this.lastHandledBackupID === result.backupID) return
    this.lastHandledBackupID = result.backupID
    this.progress.set({
      state: "completed",
      stage: "completed",
      message: "Database compaction and verification complete.",
      backupID: result.backupID,
      result,
    })
    this.dashboard.setNotice(this.compactionMessage(result))
    await this.dashboard.refreshConnectionStatus()
    this.backupRefresh.update((value) => value + 1)
    this.dashboard.refreshSessions()
  }

  private compactionMessage(result: DatabaseCompactionResult): string {
    return `Database compacted and verified: ${this.formatBytes(result.beforeBytes)} → ${this.formatBytes(result.afterBytes)} (${this.formatBytes(result.bytesReclaimed)} reclaimed); ${result.afterConversations} conversations intact. Backup is listed below.`
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
    const units = ["KB", "MB", "GB", "TB"]
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit += 1
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const details = error.error
      if (details && typeof details === "object" && typeof details.error === "string") return details.error
      if (typeof details === "string" && details.length > 0) return details
    }
    return error instanceof Error ? error.message : fallback
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
