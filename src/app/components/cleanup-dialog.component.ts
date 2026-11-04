import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, input, output } from "@angular/core"
import { CleanupPreview, Session } from "../models/session.models"

@Component({
  selector: "app-cleanup-dialog",
  standalone: true,
  templateUrl: "./cleanup-dialog.component.html",
})
export class CleanupDialogComponent implements AfterViewInit, OnDestroy {
  @ViewChild("dialog", { static: true }) private dialog!: ElementRef<HTMLDialogElement>
  private previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined

  ngAfterViewInit(): void { this.dialog.nativeElement.showModal() }

  ngOnDestroy(): void {
    this.dialog.nativeElement.close()
    if (this.previousFocus?.isConnected) this.previousFocus.focus()
  }

  onCancel(event: Event): void {
    event.preventDefault()
    if (!this.loading()) this.close.emit()
  }

  readonly preview = input.required<CleanupPreview>()
  readonly days = input(30)
  readonly selectedIDs = input<string[]>([])
  readonly loading = input(false)
  readonly error = input("")
  readonly close = output<void>()
  readonly selectedIDsChange = output<string[]>()
  readonly delete = output<void>()

  private readonly dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

  conversations(): Session[] {
    return this.preview().candidates
      .flatMap((candidate) => candidate.affectedSessions)
      .sort((a, b) => b.time.updated - a.time.updated)
  }

  selectedConversationCount(): number {
    return this.selectedIDs().length
  }

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

  toggle(sessionID: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked
    const selected = new Set(this.selectedIDs())
    const conversations = this.conversations()
    const byID = new Map(conversations.map((session) => [session.id, session]))
    const descendants = this.conversationTree(sessionID, byID)

    if (checked) {
      for (const id of descendants) selected.add(id)
    } else {
      for (const id of descendants) selected.delete(id)
      let parentID = byID.get(sessionID)?.parentID
      while (parentID) {
        selected.delete(parentID)
        parentID = byID.get(parentID)?.parentID
      }
    }

    this.selectedIDsChange.emit(conversations.map((session) => session.id).filter((id) => selected.has(id)))
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.loading()) this.close.emit()
  }

  private conversationTree(sessionID: string, byID: Map<string, Session>): string[] {
    const childrenByParent = new Map<string, string[]>()
    for (const session of byID.values()) {
      if (!session.parentID) continue
      const children = childrenByParent.get(session.parentID) ?? []
      children.push(session.id)
      childrenByParent.set(session.parentID, children)
    }
    const found: string[] = []
    const pending = [sessionID]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const current = pending.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      if (!byID.has(current)) continue
      found.push(current)
      pending.push(...(childrenByParent.get(current) ?? []))
    }
    return found
  }
}
