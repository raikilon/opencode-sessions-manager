import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { Service } from "@opencode/client/service"

export class OpenCodeClientService {
  private client?: OpenCodeClient

  async getStatus(): Promise<{ available: boolean; connected: boolean; version?: string }> {
    const endpoint = await Service.discover().catch(() => undefined)
    if (!this.client) return { available: Boolean(endpoint), connected: false }
    try {
      const info = await this.client.server.info()
      return { available: true, connected: true, version: info.version }
    } catch {
      this.client = undefined
      return { available: Boolean(endpoint), connected: false }
    }
  }

  async getClient(startService = false): Promise<OpenCodeClient | undefined> {
    if (this.client) return this.client
    const endpoint = startService ? await Service.ensure() : await Service.discover()
    if (!endpoint) return undefined
    this.client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    return this.client
  }

  async stopForMaintenance(): Promise<void> {
    await Service.stop({ pty: "handoff" })
    this.client = undefined
  }

  async restartAfterMaintenance(): Promise<{ version: string }> {
    this.client = undefined
    const client = await this.getClient(true)
    if (!client) throw new Error("OpenCode service could not be restarted after database maintenance.")
    const info = await client.server.info()
    return { version: info.version }
  }

}
