import { Injectable } from "@angular/core"

@Injectable({ providedIn: "root" })
export class SessionPreferencesService {
  private readonly retentionKey = "retentionDays"

  getRetentionDays(): number {
    const value = Number(localStorage.getItem(this.retentionKey))
    return Number.isInteger(value) && value > 0 ? Math.min(value, 3650) : 30
  }

  setRetentionDays(days: number): void {
    localStorage.setItem(this.retentionKey, String(days))
  }
}
