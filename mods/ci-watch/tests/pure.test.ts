import { expect, test } from 'claude-code/testing'
import { dayOf, deployOf, nextMidnight, ticketOf, verdictOf } from '../hooks/register'

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

test('deployOf reads the newest run of each deploy workflow', () => {
  const run = (workflowName: string, status: string, conclusion = '') => ({ workflowName, status, conclusion })
  expect(deployOf([run('tests', 'completed', 'success')]).state).toBe('none')
  expect(deployOf([run('Deploy staging', 'in_progress'), run('tests', 'completed', 'failure')]).state).toBe('pending')
  expect(deployOf([run('Deploy staging', 'completed', 'success'), run('Deploy staging', 'completed', 'failure')]).state).toBe('success')
  expect(deployOf([run('deploy', 'completed', 'success'), run('staging-smoke', 'completed', 'failure')]).state).toBe('failure')
  expect(deployOf([run('deploy', 'completed', 'skipped')]).state).toBe('success')
})

test('ticketOf finds a ticket id in a PR title, else null', () => {
  expect(ticketOf('[SN-12] Fix it')).toBe('SN-12')
  expect(ticketOf('CU-86c0abc Fix it')).toBe('CU-86c0abc')
  expect(ticketOf('Fix it')).toBe(null)
  expect(ticketOf(undefined)).toBe(null)
})

test('the day of the cap is local, and resets at the next local midnight', () => {
  const t = new Date(2026, 10, 25, 23, 59).getTime()
  expect(dayOf(t)).toBe('2026-11-25')
  expect(new Date(nextMidnight(t)).getTime()).toBe(new Date(2026, 10, 26, 0, 0).getTime())
  expect(dayOf(new Date(nextMidnight(t)).getTime())).toBe('2026-11-26')
})
