import { TestBed } from "@angular/core/testing"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConfirmationService } from "../services/confirmation.service"
import { ConfirmationDialogComponent } from "./confirmation-dialog.component"

describe("ConfirmationDialogComponent", () => {
  const options = { title: "Delete conversation?", message: "This cannot be undone.", confirmLabel: "Delete conversation", danger: true }
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ConfirmationDialogComponent] })
    // jsdom does not implement the browser's top-layer dialog behavior.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn() })
  })
  afterEach(() => TestBed.resetTestingModule())

  it("requires an explicit action and ignores duplicate requests", async () => {
    const service = TestBed.inject(ConfirmationService)
    const decision = service.confirm(options)
    await expect(service.confirm({ ...options, title: "Another action" })).resolves.toBe(false)
    const fixture = TestBed.createComponent(ConfirmationDialogComponent)
    fixture.detectChanges()
    expect(fixture.nativeElement.textContent).toContain("Delete conversation?")
    expect(fixture.nativeElement.querySelector("[autofocus]").textContent).toContain("Cancel")
    expect(service.request()).toEqual(options)
    fixture.nativeElement.querySelector(".button-danger").click()
    await expect(decision).resolves.toBe(true)
    expect(service.request()).toBeUndefined()
  })

  it("cancels with Escape and restores the initiating control's focus", async () => {
    const trigger = document.createElement("button")
    document.body.append(trigger)
    trigger.focus()
    const service = TestBed.inject(ConfirmationService)
    const decision = service.confirm(options)
    const fixture = TestBed.createComponent(ConfirmationDialogComponent)
    fixture.detectChanges()
    fixture.nativeElement.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }))
    await expect(decision).resolves.toBe(false)
    fixture.destroy()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it("cancels when the component is destroyed without a decision", async () => {
    const service = TestBed.inject(ConfirmationService)
    const decision = service.confirm(options)
    const fixture = TestBed.createComponent(ConfirmationDialogComponent)
    fixture.detectChanges()
    fixture.destroy()
    await expect(decision).resolves.toBe(false)
  })

  it("cancels through the Cancel button", async () => {
    const service = TestBed.inject(ConfirmationService)
    const decision = service.confirm(options)
    const fixture = TestBed.createComponent(ConfirmationDialogComponent)
    fixture.detectChanges()
    fixture.nativeElement.querySelector("[autofocus]").click()
    await expect(decision).resolves.toBe(false)
  })
})
