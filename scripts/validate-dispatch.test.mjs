import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { validateDocumentationDispatch } from './validate-dispatch.mjs'

const repository = 'VladimirNilov28/tcp-proxy-from-scratch'
const sources = [{ repository }, { repository: 'example/another-project' }]
const event = repository => ({
  action: 'documentation-updated',
  client_payload: { repository }
})

test('accepts the expected event from any configured repository', () => {
  for (const source of sources) {
    assert.doesNotThrow(() => validateDocumentationDispatch(event(source.repository), sources))
  }
})

test('rejects unexpected event types, even for configured repositories', () => {
  for (const action of ['push', 'other-event', '', undefined, null]) {
    assert.throws(() => validateDocumentationDispatch({ ...event(repository), action }, sources), /event type/)
  }
})

test('rejects missing, malformed, or unconfigured repository payloads', () => {
  for (const value of [undefined, null, '', 123, [], {}, 'example/unknown',
    `${repository}/extra`, repository.toLowerCase(), `${repository}\n`]) {
    assert.throws(() => validateDocumentationDispatch(event(value), sources), /configured documentation source/)
  }
  for (const value of [undefined, null, {}, { action: 'documentation-updated' },
    { action: 'documentation-updated', client_payload: null }]) {
    assert.throws(() => validateDocumentationDispatch(value, sources))
  }
  assert.throws(() => validateDocumentationDispatch(event(repository), []), /configured documentation source/)
})

test('CLI accepts configured sources and fails closed without echoing an unsupported payload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-dispatch-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const eventPath = join(directory, 'event.json')
  const script = fileURLToPath(new URL('./validate-dispatch.mjs', import.meta.url))
  const run = () => spawnSync(process.execPath, [script], {
    env: { ...process.env, GITHUB_EVENT_PATH: eventPath }, encoding: 'utf8'
  })
  await writeFile(eventPath, JSON.stringify(event(repository)))
  const accepted = run()
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.match(accepted.stdout, /accepted/)
  const unsupported = 'example/untrusted-payload-marker'
  await writeFile(eventPath, JSON.stringify(event(unsupported)))
  const rejected = run()
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /configured documentation source/)
  assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes(unsupported))
  await writeFile(eventPath, JSON.stringify({ ...event(repository), action: 'wrong-event' }))
  assert.equal(run().status, 1)
})
