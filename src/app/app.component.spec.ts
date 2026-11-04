import { provideHttpClient } from "@angular/common/http"
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing"
import { ApplicationRef } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AppComponent } from "./app.component"

describe("AppComponent", () => {
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it("does not load session data until the user connects", async () => {
    const fixture = TestBed.createComponent(AppComponent)
    fixture.detectChanges()
    TestBed.tick()

    http.expectOne("/api/status").flush({ available: true })
    await TestBed.inject(ApplicationRef).whenStable()
    fixture.detectChanges()

    expect(fixture.nativeElement.textContent).toContain("Connect to your local OpenCode")
    http.expectNone("/api/sessions")
    http.expectNone("/api/projects")

    fixture.nativeElement.querySelector(".button-primary").click()
    fixture.detectChanges()
    http.expectOne("/api/connect").flush({ connected: true, version: "test" })
    await Promise.resolve()
    TestBed.tick()

    const sessionsRequest = http.expectOne("/api/sessions?archived=all")
    const projectsRequest = http.expectOne("/api/projects")
    const backupsRequest = http.expectOne("/api/database/backups?refresh=0")
    sessionsRequest.flush({
      data: [],
      activeIDs: [],
      totalSessions: 3,
      database: { available: false, databaseBytes: null, walBytes: 0, totalBytes: null, source: "default location" },
      relationships: [],
    })
    projectsRequest.flush([])
    backupsRequest.flush([])
    await TestBed.inject(ApplicationRef).whenStable()
    fixture.detectChanges()

    expect(fixture.nativeElement.textContent).toContain("Connected · vtest")
    expect(fixture.nativeElement.textContent).toContain("3")
    fixture.destroy()
  })

  it("restores the connected view after a page refresh when the backend connection is healthy", async () => {
    const fixture = TestBed.createComponent(AppComponent)
    fixture.detectChanges()
    TestBed.tick()

    http.expectOne("/api/status").flush({ available: true, connected: true, version: "test" })
    await Promise.resolve()
    TestBed.tick()
    fixture.detectChanges()
    expect(fixture.nativeElement.textContent).toContain("Connected · vtest")

    const sessionsRequest = http.expectOne("/api/sessions?archived=all")
    const projectsRequest = http.expectOne("/api/projects")
    const backupsRequest = http.expectOne("/api/database/backups?refresh=0")
    sessionsRequest.flush({
      data: [],
      activeIDs: [],
      totalSessions: 520,
      database: { available: true, databaseBytes: 4096, walBytes: 0, totalBytes: 4096, source: "OpenCode database path" },
      relationships: [],
    })
    projectsRequest.flush([])
    backupsRequest.flush([])
    await TestBed.inject(ApplicationRef).whenStable()
    fixture.detectChanges()

    expect(fixture.nativeElement.textContent).toContain("Connected · vtest")
    expect(fixture.nativeElement.textContent).toContain("520 conversations")
    http.expectNone("/api/connect")
    fixture.destroy()
  })
})
