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

test('repository-level agent instructions require the complete delivery lifecycle', () => {
  assert.match(agents, /every AI agent/i);
  assert.match(agents, /understand -> inspect -> plan -> implement -> focused tests -> review\/security -> documentation -> PR\/CI -> merge -> post-merge verification -> close\/checkpoint/);
  assert.match(agents, /docs\/AI_AGENT_WORKFLOW\.md/);
  assert.match(agents, /docs\/TESTING_POLICY\.md/);
  assert.match(agents, /Do not make feature\/fix changes directly on `main`/);
  assert.match(agents, /Do not merge while relevant required checks are still pending or failing/);
  assert.match(agents, /Verify after merge/);
  assert.match(agents, /Definition of done/i);
});

test('detailed agent workflow protects multi-agent coordination and engineering risk classes', () => {
  assert.match(workflow, /check open PRs and active branches for overlapping work/i);
  assert.match(workflow, /conclusions from another agent are evidence to verify, not unquestionable truth/i);
  assert.match(workflow, /review agent must inspect the actual diff/i);
  assert.match(workflow, /coordinator must inspect actual CI\/check results/i);
  assert.match(workflow, /Do not introduce a second authentication, migration, authorization, audit, scheduler, persistence or configuration mechanism/i);
  assert.match(workflow, /concurrency, idempotency and retries/i);
  assert.match(workflow, /persistence, restart and crash recovery/i);
  assert.match(workflow, /fail-open versus fail-closed/i);
  assert.match(workflow, /rollback and operator recovery/i);
  assert.match(workflow, /Never make a test weaker just because it is red/i);
  assert.match(workflow, /The merged repository is the final artifact, not the PR branch/i);
  assert.match(workflow, /confirmed by test\/CI/i);
  assert.match(workflow, /inferred/i);
  assert.match(workflow, /not verified/i);
});

test('agent workflow keeps test policy and PR evidence contracts connected', () => {
  assert.match(testingPolicy, /risk/i);
  assert.match(prTemplate, /## Validation/);
  assert.match(prTemplate, /## Security and operational impact/);
  assert.match(prTemplate, /## Documentation impact/);
  assert.match(prTemplate, /## Coordination/);
  assert.match(prTemplate, /## Source-of-truth review/);
  assert.match(prTemplate, /## Rollback \/ recovery/);
});
