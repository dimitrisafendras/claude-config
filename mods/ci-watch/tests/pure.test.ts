import { expect, test } from 'claude-code/testing'
import { verdictOf } from '../hooks/register'

const run = (name: string, conclusion: string | undefined, startedAt: string, status = 'COMPLETED') => ({
  __typename: 'CheckRun',
  name,
  workflowName: name,
  status,
  conclusion,
  startedAt,
  detailsUrl: `https://github.com/acme/web-app/actions/runs/${startedAt.replace(/\D/g, '')}/job/1`,
})

test('a cancelled run that a newer run of the same check replaced is not a failure', () => {
  const older = run('record', 'CANCELLED', '2026-01-01T10:00:00Z')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [older, run('record', 'SUCCESS', '2026-01-01T10:00:05Z')] }).verdict).toBe('green')
  expect(
    verdictOf({ state: 'OPEN', statusCheckRollup: [older, run('record', undefined, '2026-01-01T10:00:05Z', 'IN_PROGRESS')] }).verdict,
  ).toBe('pending')
  const red = verdictOf({ state: 'OPEN', statusCheckRollup: [older, run('record', 'FAILURE', '2026-01-01T10:00:05Z')] })
  expect(red.verdict).toBe('red')
  expect(red.failed.length).toBe(1)
})

test('a cancelled run stays a failure when nothing replaced it', () => {
  const cancelled = run('record', 'CANCELLED', '2026-01-01T10:00:05Z')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [cancelled] }).verdict).toBe('red')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [cancelled, run('tests', 'SUCCESS', '2026-01-01T10:00:09Z')] }).verdict).toBe('red')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [run('record', 'SUCCESS', '2026-01-01T10:00:00Z'), cancelled] }).verdict).toBe('red')
  expect(
    verdictOf({ state: 'OPEN', statusCheckRollup: [run('record', 'CANCELLED', '2026-01-01T10:00:00Z'), cancelled] }).verdict,
  ).toBe('red')
})
