import type { OpenCodeClient } from "@opencode/client"
import { ArchiveFilter, getAllSessions } from "./session-repository.js"

// Message scanning used by both the HTTP and MCP adapters.
export interface ContentSearchMatch {
  sessionID: string
  title: string
  projectID: string
  directory: string
  updated: number
  snippets: string[]
}

export async function searchContentSessions(
  api: OpenCodeClient,
  query: string,
  options: { archived: ArchiveFilter; project?: string },
): Promise<{ totalSessions: number; matches: ContentSearchMatch[]; failedSessions: number }> {
  const sessions = await getAllSessions(api, options)
  const matches: ContentSearchMatch[] = []
  let nextIndex = 0
  let failedSessions = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < sessions.length) {
      const session = sessions[nextIndex++]
      let snippets: string[]
      try {
        snippets = await findSessionSnippets(api, session.id, query)
      } catch {
        // A single unreadable session should not make every other conversation unsearchable.
        failedSessions += 1
        continue
      }
      if (snippets.length === 0) continue
      matches.push({
        sessionID: session.id,
        title: session.title || "Untitled session",
        projectID: session.projectID,
        directory: session.location.directory,
        updated: session.time.updated,
        snippets,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, sessions.length) }, worker))
  matches.sort((a, b) => b.updated - a.updated)
  return { totalSessions: sessions.length, matches, failedSessions }
}

async function findSessionSnippets(api: OpenCodeClient, sessionID: string, query: string): Promise<string[]> {
  const snippets: string[] = []
  let cursor: string | undefined
  const needle = query.toLocaleLowerCase()

  do {
    const page = await api.message.list({ sessionID, limit: 100, order: "desc", cursor })
    for (const message of page.data) {
      for (const text of searchableText(message)) {
        const snippet = makeSnippet(text, query, needle)
        if (!snippet) continue
        snippets.push(snippet)
        if (snippets.length >= 3) break
      }
      if (snippets.length >= 3) break
    }
    cursor = snippets.length >= 3 ? undefined : page.cursor.next ?? undefined
  } while (cursor)

  return snippets
}

function searchableText(message: Awaited<ReturnType<OpenCodeClient["message"]["list"]>>["data"][number]): string[] {
  if (message.type === "user") return [message.text]
  if (message.type === "assistant") return message.content.filter((part) => part.type === "text").map((part) => part.text)
  return []
}

function makeSnippet(text: string, query: string, needle: string): string | undefined {
  const position = text.toLocaleLowerCase().indexOf(needle)
  if (position < 0) return undefined
  const start = Math.max(0, position - 75)
  const end = Math.min(text.length, position + query.length + 100)
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`
}
