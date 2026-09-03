import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const agentsPath = new URL('../AGENTS.md', import.meta.url);
const workflowPath = new URL('../docs/AI_AGENT_WORKFLOW.md', import.meta.url);
const testingPolicyPath = new URL('../docs/TESTING_POLICY.md', import.meta.url);
const prTemplatePath = new URL('../.github/pull_request_template.md', import.meta.url);

const agents = fs.readFileSync(agentsPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const testingPolicy = fs.readFileSync(testingPolicyPath, 'utf8');
const prTemplate = fs.readFileSync(prTemplatePath, 'utf8');

function requireAll(source, patterns, label) {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${label} is missing ${pattern}`);
  }
}

test('root agent contract keeps the non-negotiable delivery gates', () => {
  requireAll(agents, [
    /every AI agent/i,
    /docs\/AI_AGENT_WORKFLOW\.md/,
    /docs\/TESTING_POLICY\.md/,
    /dedicated branch and PR/i,
    /not directly on `main`/i,
    /relevant red tests must be investigated/i,
    /review the final combined diff/i,
    /required checks pending or failing/i,
    /post-merge checks/i,
    /Definition of done/i,
  ], 'AGENTS.md');
});

test('detailed workflow defines scalable risk levels and high-value engineering safeguards', () => {
  requireAll(workflow, [
    /## Risk levels/,
    /Level 1 — low risk/,
    /Level 2 — normal product change/,
    /Level 3 — high risk/,
    /check open PRs and active branches for overlapping work/i,
    /one workstream has one clear owner\/coordinator/i,
    /actual final diff/i,
    /actual CI\/check results/i,
    /second authentication, authorization, migration, audit, scheduler, persistence, or configuration mechanism/i,
    /concurrency\/idempotency/i,
    /restart\/crash persistence/i,
    /fail-open versus fail-closed/i,
    /rollback\/operator recovery/i,
    /Do not weaken a valid test merely because it is red/i,
    /merged repository is the final artifact/i,
    /confirmed by test\/CI/i,
    /inferred/i,
    /not verified/i,
  ], 'docs/AI_AGENT_WORKFLOW.md');
});

test('agent workflow remains connected to test and PR evidence sources of truth', () => {
  requireAll(testingPolicy, [
    /risk-based test selection/i,
    /scripts\/auth-e2e-scope\.mjs/,
  ], 'docs/TESTING_POLICY.md');

  requireAll(prTemplate, [
    /## Validation/,
    /## Security and operational impact/,
    /## Documentation impact/,
    /## Coordination/,
    /## Source-of-truth review/,
    /## Rollback \/ recovery/,
  ], '.github/pull_request_template.md');
});
