import 'dotenv/config'
import { createApp } from './app.js'
import { disconnect } from './db/client.js'
import { initRealtime, closeRealtime } from './lib/realtime.js'

const port = Number(process.env.PORT ?? 3001)
const app = createApp()

const server = app.listen(port, () => {
  console.log(`SoberLife API listening on :${port}`)
})
initRealtime(server)

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  // Sockets first: their keep-alive connections stop server.close() from ever
  // calling back.
  await closeRealtime()
  server.close(async () => {
    await disconnect()
    process.exit(0)
  })
  // A browser's idle keep-alive connections also hold close() open — seen in
  // dev, where `node --watch` sat at "Waiting for graceful termination"
  // forever with the admin app open. Drop them, and keep a hard exit as the
  // backstop.
  server.closeAllConnections?.()
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
