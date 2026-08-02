import 'dotenv/config'
import { createApp } from './app.js'
import { disconnect } from './db/client.js'

const port = Number(process.env.PORT ?? 3001)
const app = createApp()

const server = app.listen(port, () => {
  console.log(`SoberLife API listening on :${port}`)
})

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  server.close(async () => {
    await disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
