import { TestBed } from "@angular/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CleanupPreview } from "../models/session.models"
import { CleanupDialogComponent } from "./cleanup-dialog.component"

const preview: CleanupPreview = {
  candidates: [{
    session: {
      id: "ses_old",
      projectID: "project-a",
      title: "Old conversation",
      location: { directory: "/workspace/project-a" },
      time: { created: 1, updated: 1 },
    },
    affectedCount: 1,
    affectedIDs: ["ses_old"],
    affectedSessions: [{
      id: "ses_old",
      projectID: "project-a",
      title: "Old conversation",
      location: { directory: "/workspace/project-a" },
      time: { created: 1, updated: 1 },
    }],
  }],
  eligibleCount: 1,
  protectedCount: 0,
  totalSessions: 1,
  database: { available: true, databaseBytes: 2048, walBytes: 0, totalBytes: 2048, source: "default location" },
}

describe("CleanupDialogComponent", () => {
  let fixture: ReturnType<typeof TestBed.createComponent<CleanupDialogComponent>>

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CleanupDialogComponent] })
    fixture = TestBed.createComponent(CleanupDialogComponent)
    fixture.componentRef.setInput("preview", preview)
    fixture.detectChanges()
  })

  afterEach(() => fixture.destroy())

  it("emits the selected cleanup IDs", () => {
    let selection: string[] = []
    fixture.componentInstance.selectedIDsChange.subscribe((value) => selection = value)
    const checkbox = fixture.nativeElement.querySelector(".cleanup-item input") as HTMLInputElement

    checkbox.checked = true
    checkbox.dispatchEvent(new Event("change", { bubbles: true }))

    expect(selection).toEqual(["ses_old"])
  })

  it("shows conversations as selectable rows without deleting immediately", () => {
    expect(fixture.nativeElement.textContent).toContain("Old conversation")
    expect(fixture.nativeElement.querySelector(".cleanup-item input").checked).toBe(false)
  })

  it("includes child conversations when their parent is selected", () => {
    const treePreview: CleanupPreview = {
      ...preview,
      candidates: [{
        ...preview.candidates[0],
        affectedCount: 2,
        affectedIDs: ["ses_old", "ses_child"],
        affectedSessions: [
          preview.candidates[0].affectedSessions[0],
          {
            id: "ses_child",
            parentID: "ses_old",
            projectID: "project-a",
            title: "Child conversation",
            location: { directory: "/workspace/project-a" },
            time: { created: 1, updated: 1 },
          },
        ],
      }],
      eligibleCount: 2,
      totalSessions: 2,
    }
    fixture.componentRef.setInput("preview", treePreview)
    fixture.detectChanges()
    let selection: string[] = []
    fixture.componentInstance.selectedIDsChange.subscribe((value) => selection = value)

    const parentCheckbox = fixture.nativeElement.querySelectorAll(".cleanup-item input")[0] as HTMLInputElement
    parentCheckbox.checked = true
    parentCheckbox.dispatchEvent(new Event("change", { bubbles: true }))

    expect(selection).toEqual(["ses_old", "ses_child"])
  })
})
