import { createServer } from "node:http"
import { createHttpApp } from "./http/app.js"

const port = Number(process.env.PORT ?? (process.env.NODE_ENV === "production" ? 4173 : 4174))
const server = createServer(createHttpApp())

server.listen(port, "127.0.0.1", () => {
  console.log(`OpenCode Sessions Manager API listening at http://127.0.0.1:${port}`)
})
