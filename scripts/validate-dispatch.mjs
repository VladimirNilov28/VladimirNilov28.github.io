import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateDocumentationDispatch(event, sources) {
  if (event?.action !== 'documentation-updated') {
    throw new Error('Unsupported repository_dispatch event type.')
  }
  const repository = event.client_payload?.repository
  if (typeof repository !== 'string' || !Array.isArray(sources) ||
      !sources.some(source => source?.repository === repository)) {
    throw new Error('client_payload.repository must exactly match a configured documentation source.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH is required.')
    const [event, sources] = await Promise.all([
      readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
      readFile(new URL('../docs.sources.json', import.meta.url), 'utf8')
    ])
    validateDocumentationDispatch(JSON.parse(event), JSON.parse(sources))
    console.log('Documentation dispatch accepted for a configured source.')
  } catch (error) {
    console.error(`Documentation dispatch rejected: ${error.message}`)
    process.exitCode = 1
  }
}
