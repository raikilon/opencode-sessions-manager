import { Component, input, output } from "@angular/core"
import { DatabaseBackupInfo, DatabaseFootprint } from "../models/session.models"

@Component({
  selector: "app-overview-cards",
  standalone: true,
  templateUrl: "./overview-cards.component.html",
})
export class OverviewCardsComponent {
  readonly totalSessions = input.required<number>()
  readonly database = input<DatabaseFootprint>()
  readonly compacting = input(false)
  readonly compactionMessage = input("")
  readonly backups = input<DatabaseBackupInfo[]>([])
  readonly deletingBackupID = input<string | undefined>(undefined)
  readonly compactRequested = output<void>()
  readonly deleteBackupRequested = output<string>()

  private readonly dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

  formatDate(timestamp: number): string {
    return this.dateFormat.format(new Date(timestamp))
  }

  formatBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "Unavailable"
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
}
