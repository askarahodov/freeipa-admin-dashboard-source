# Development and repository governance

This section contains development-process and repository-governance documentation that is not GitHub-native configuration.

- [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) — docs-as-code policy, active-document rules and multi-agent documentation governance.
- [`AGENT_BRANCH_POLICY.md`](AGENT_BRANCH_POLICY.md) — short-lived AI-agent branch lifecycle, safe cleanup and parallel-work coordination.
- [`REQUIRED_CHECKS.md`](REQUIRED_CHECKS.md) — stable branch-protection checks, CI composition, test sharding and Auth E2E routing.
- [`DEPENDABOT_POLICY.md`](DEPENDABOT_POLICY.md) — bounded dependency-update capacity and dependency PR coordination.
- [`TEST_LAYOUT.md`](TEST_LAYOUT.md) — target Node test/E2E ownership layout and migration invariants for #270.

GitHub-native configuration remains under `.github/`, including workflows, `dependabot.yml` and the pull-request template.
