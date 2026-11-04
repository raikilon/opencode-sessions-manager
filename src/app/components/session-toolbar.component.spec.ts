import { TestBed } from "@angular/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SessionToolbarComponent } from "./session-toolbar.component"

describe("SessionToolbarComponent", () => {
  let fixture: ReturnType<typeof TestBed.createComponent<SessionToolbarComponent>>

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SessionToolbarComponent] })
    fixture = TestBed.createComponent(SessionToolbarComponent)
    fixture.detectChanges()
  })

  afterEach(() => fixture.destroy())

  it("emits the selected search mode", () => {
    let selectedMode = ""
    fixture.componentInstance.searchModeChange.subscribe((mode) => selectedMode = mode)

    const buttons = Array.from(fixture.nativeElement.querySelectorAll(".search-mode button")) as HTMLButtonElement[]
    buttons.find((button) => button.textContent?.includes("Conversation text"))?.click()

    expect(selectedMode).toBe("content")
  })

  it("emits a search request when the form is submitted", () => {
    let submitted = false
    fixture.componentInstance.searchRequested.subscribe(() => submitted = true)
    const form = fixture.nativeElement.querySelector("form") as HTMLFormElement

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

    expect(submitted).toBe(true)
  })
})
