import { HttpErrorResponse, httpResource } from "@angular/common/http"
import { Injectable, computed, effect, inject, signal } from "@angular/core"
import { CleanupPreview } from "../models/session.models"
import { ConfirmationService } from "./confirmation.service"
import { SessionApiService } from "./session-api.service"
import { SessionDashboardStore } from "./session-dashboard.store"
import { SessionPreferencesService } from "./session-preferences.service"

interface CleanupRequest {
  days: number
  run: number
}

const EMPTY_CLEANUP: CleanupPreview = {
  candidates: [],
  eligibleCount: 0,
  protectedCount: 0,
  totalSessions: 0,
  database: { available: false, databaseBytes: null, walBytes: 0, totalBytes: null, source: "OpenCode database path unavailable" },
}

@Injectable({ providedIn: "root" })
export class CleanupStore {
  private readonly confirmation = inject(ConfirmationService)
  private readonly api = inject(SessionApiService)
  private readonly dashboard = inject(SessionDashboardStore)
  private readonly preferences = inject(SessionPreferencesService)

  readonly retentionDays = signal(this.preferences.getRetentionDays())
  readonly request = signal<CleanupRequest | undefined>(undefined)
  private readonly previewResource = httpResource<CleanupPreview>(() => {
    const request = this.request()
    if (!this.dashboard.connected() || !request) return undefined
    return { url: "/api/cleanup/preview", params: { days: request.days } }
  }, { defaultValue: EMPTY_CLEANUP })

  readonly preview = computed(() => {
    if (!this.request() || this.previewResource.status() !== "resolved") return undefined
    return this.previewResource.value()
  })
  readonly loading = computed(() => Boolean(this.request()) && this.previewResource.isLoading())
  readonly deleting = signal(false)
  readonly selectedIDs = signal<string[]>([])
  readonly actionError = signal("")
  readonly error = computed(() => {
    if (this.actionError()) return this.actionError()
    if (this.previewResource.status() === "error") return this.errorMessage(this.previewResource.error())
    return ""
  })

  private previewRun = 0

  private readonly selectAllEligibleEffect = effect(() => {
    const preview = this.preview()
    if (!preview) return
    this.selectedIDs.set(preview.candidates.flatMap((candidate) => candidate.affectedIDs))
  })

  setRetentionDays(days: number): void {
    this.retentionDays.set(Math.min(3650, Math.max(1, Number.isInteger(days) ? days : 1)))
  }

  openPreview(): void {
    this.actionError.set("")
    this.preferences.setRetentionDays(this.retentionDays())
    this.request.set({ days: this.retentionDays(), run: ++this.previewRun })
  }

  closePreview(): void {
    this.request.set(undefined)
    this.selectedIDs.set([])
    this.actionError.set("")
  }

  updateSelection(sessionIDs: string[]): void {
    this.selectedIDs.set(sessionIDs)
  }

  dismissError(): void {
    this.actionError.set("")
  }

  async deleteSelected(): Promise<void> {
    const preview = this.preview()
    const sessionIDs = this.selectedIDs()
    if (!preview || sessionIDs.length === 0) return
    const days = this.retentionDays()
    if (!await this.confirmation.confirm({
      title: "Delete selected conversations?",
      message: `Permanently delete ${sessionIDs.length} conversation${sessionIDs.length === 1 ? "" : "s"} older than ${days} days? This cannot be undone.`,
      confirmLabel: `Delete ${sessionIDs.length} conversation${sessionIDs.length === 1 ? "" : "s"}`,
      danger: true,
    })) return

    this.deleting.set(true)
    this.actionError.set("")
    try {
      const result = await this.api.deleteCleanup(days, sessionIDs)
      this.closePreview()
      this.dashboard.setNotice(`Deleted ${result.deletedSessions} old conversation${result.deletedSessions === 1 ? "" : "s"}.`)
      this.dashboard.clearContentSearch()
      this.dashboard.refreshSessions()
    } catch (error) {
      const details = error instanceof HttpErrorResponse ? error.error : undefined
      const deleted = typeof details?.deletedSessions === "number" ? details.deletedSessions : 0
      this.actionError.set(`${deleted > 0 ? `Deleted ${deleted} conversation${deleted === 1 ? "" : "s"} before cleanup stopped. ` : ""}${this.errorMessage(error)} Review the refreshed list before retrying.`)
      this.selectedIDs.set([])
      this.dashboard.clearContentSearch()
      this.dashboard.refreshSessions()
      this.previewResource.reload()
    } finally {
      this.deleting.set(false)
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === "string") return error.error.error
    return error instanceof Error ? error.message : "Cleanup failed."
  }
}
