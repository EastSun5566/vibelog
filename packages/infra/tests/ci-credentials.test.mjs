import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflows = new URL('../../../.github/workflows/', import.meta.url);
describe('pull-request credential boundary', () => {
  it('never grants PR workflows production authentication or OIDC permissions', () => {
    const pullRequestWorkflows = readdirSync(workflows).filter((name) => name.endsWith('.yml'))
      .map((name) => readFileSync(new URL(name, workflows), 'utf8'))
      .filter((workflow) => /^ {2}pull_request(?:_target)?:/mu.test(workflow));
    expect(pullRequestWorkflows.length).toBeGreaterThan(0);
    for (const workflow of pullRequestWorkflows) {
      expect(workflow).not.toMatch(/id-token:\s*write/u);
      expect(workflow).not.toMatch(/pulumi\/(?:auth-actions|esc-action)@/u);
      expect(workflow).not.toMatch(/environment:\s*production/iu);
      expect(workflow).not.toContain('EastSun5566/vibelog/prod');
    }
    const ci = readFileSync(new URL('ci.yml', workflows), 'utf8');
    expect(ci).toContain('pnpm --filter @vibelog/infra test');
  });
});
