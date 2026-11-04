import { TestBed } from "@angular/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OverviewCardsComponent } from "./overview-cards.component"

describe("OverviewCardsComponent", () => {
  let fixture: ReturnType<typeof TestBed.createComponent<OverviewCardsComponent>>

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [OverviewCardsComponent] })
    fixture = TestBed.createComponent(OverviewCardsComponent)
    fixture.componentRef.setInput("totalSessions", 520)
    fixture.componentRef.setInput("database", {
      available: true,
      databaseBytes: 4096,
      walBytes: 0,
      totalBytes: 4096,
      source: "default location",
    })
    fixture.componentRef.setInput("backups", [{
      id: "opencode.db.test.backup",
      sizeBytes: 2048,
      createdAt: 1,
      verified: true,
      beforeBytes: 4096,
      afterBytes: 2048,
      verifiedConversationCount: 520,
    }])
    fixture.detectChanges()
  })

  afterEach(() => fixture.destroy())

  it("emits compaction and backup deletion actions", () => {
    let compactRequested = false
    let backupID = ""
    fixture.componentInstance.compactRequested.subscribe(() => compactRequested = true)
    fixture.componentInstance.deleteBackupRequested.subscribe((id) => backupID = id)

    const buttons = Array.from(fixture.nativeElement.querySelectorAll("button")) as HTMLButtonElement[]
    buttons.find((button) => button.textContent?.includes("Compact database"))?.click()
    buttons.find((button) => button.textContent?.includes("Delete backup"))?.click()

    expect(compactRequested).toBe(true)
    expect(backupID).toBe("opencode.db.test.backup")
  })
})
