import { HttpErrorResponse, provideHttpClient } from "@angular/common/http"
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing"
import { TestBed } from "@angular/core/testing"
import { ApplicationRef, signal } from "@angular/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CleanupStore } from "./cleanup.store"
import { SessionDashboardStore } from "./session-dashboard.store"
import { SessionApiService } from "./session-api.service"
import { ConfirmationService } from "./confirmation.service"
import { SessionPreferencesService } from "./session-preferences.service"

describe("CleanupStore recovery", () => {
  afterEach(() => TestBed.resetTestingModule())
  it("reports partial deletion and reloads the preview and dashboard", async () => {
    const dashboard = { connected: signal(true), clearContentSearch: vi.fn(), refreshSessions: vi.fn() }
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: SessionDashboardStore, useValue: dashboard },
      { provide: SessionPreferencesService, useValue: { getRetentionDays: () => 30, setRetentionDays: vi.fn() } },
      { provide: ConfirmationService, useValue: { confirm: async () => true } },
      { provide: SessionApiService, useValue: { deleteCleanup: async () => { throw new HttpErrorResponse({ status: 500, error: { deletedSessions: 1, error: "A conversation became unavailable." } }) } } },
    ] })
    const store = TestBed.inject(CleanupStore)
    const http = TestBed.inject(HttpTestingController)
    store.openPreview()
    TestBed.tick()
    http.expectOne('/api/cleanup/preview?days=30').flush({ candidates: [], eligibleCount: 2, totalSessions: 2, protectedCount: 0 })
    await TestBed.inject(ApplicationRef).whenStable()
    TestBed.tick()
    store.updateSelection(["one", "two"])
    await store.deleteSelected()
    expect(store.error()).toContain("Deleted 1 conversation")
    expect(store.error()).toContain("A conversation became unavailable.")
    expect(dashboard.refreshSessions).toHaveBeenCalledOnce()
    expect(dashboard.clearContentSearch).toHaveBeenCalledOnce()
    TestBed.tick()
    http.expectOne('/api/cleanup/preview?days=30').flush({ candidates: [], eligibleCount: 0, totalSessions: 0, protectedCount: 0 })
    await TestBed.inject(ApplicationRef).whenStable()
    TestBed.tick()
    expect(store.error()).toContain("Deleted 1 conversation")
    expect(store.deleting()).toBe(false)
    http.verify()
  })
})
