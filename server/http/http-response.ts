import type { Response } from "express"

export function sendError(response: Response, error: unknown, status = 500): void {
  response.status(status).json({ error: errorMessage(error) })
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred."
}
