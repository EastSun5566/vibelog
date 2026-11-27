import { createHash } from 'node:crypto';
import { agentInstructions } from './agent/views.js';
import { AGENT_API } from './agent/contracts.js';

/**
 * Agent discovery documents for the app origin. Each one only points at surfaces this app
 * actually serves; the CLI-backed pieces appear only when a stable CLI version is configured.
 */

const SOURCE_REPOSITORY = 'https://github.com/EastSun5566/vibelog';
const CLI_PACKAGE_URL = 'https://www.npmjs.com/package/@vibelog/cli';
const SUMMARY =
  'Publish your HackMD articles as a searchable blog with AI-designed styles, RSS, a sitemap, and llms.txt.';

export const AGENT_SKILLS_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
export const API_CATALOG_PROFILE = 'https://www.rfc-editor.org/info/rfc9727';
export const AGENT_SKILL_NAME = 'vibelog';
const AGENT_SKILL_DESCRIPTION =
  'Set up or update a VibeLog blog from public HackMD notes with the pinned VibeLog CLI: connect HackMD, adjust the design, review a private draft, and publish only on an explicit request.';

const at = (origin: string, path: string) => new URL(path, origin).href;

export function llmsTxt(origin: string, cliVersion?: string): string {
  const docs = [
    `- [Writer guide](${at(origin, '/guide')}): How syncing, private drafts, design and publishing work.`,
    ...(cliVersion
      ? [
          `- [Agent setup instructions](${at(origin, '/agent-setup/prompt.md')}): Authorization, the read-before-change workflow, and publishing boundaries for coding agents.`,
        ]
      : []),
  ];
  const api = [
    `- [OpenAPI document](${at(origin, '/openapi.json')}): The agent API at ${at(origin, AGENT_API)}, authenticated with a browser-approved bearer token.`,
    `- [API catalog](${at(origin, '/.well-known/api-catalog')}): RFC 9727 links to the API, its description and docs.`,
  ];
  const optional = [
    `- [Source code](${SOURCE_REPOSITORY}): VibeLog is open source.`,
    ...(cliVersion
      ? [
          `- [Agent skill index](${at(origin, '/.well-known/agent-skills/index.json')}): The same setup instructions as a reusable agent skill.`,
        ]
      : []),
  ];
  return [
    '# VibeLog',
    '',
    `> ${SUMMARY}`,
    '',
    'Writers keep writing in HackMD. VibeLog imports only public, published notes, builds a private draft to review, and publishes it to a subdomain of this site. Coding agents can prepare that draft through the agent API; publishing needs separate, browser-approved permission and an explicit request from the writer.',
    '',
    '## Docs',
    '',
    ...docs,
    '',
    '## API',
    '',
    ...api,
    ...(cliVersion
      ? [
          '',
          '## CLI',
          '',
          `- [@vibelog/cli](${CLI_PACKAGE_URL}): Run \`npx --yes @vibelog/cli@${cliVersion}\`; it handles login, context, design validation and builds.`,
        ]
      : []),
    '',
    '## Optional',
    '',
    ...optional,
    '',
  ].join('\n');
}

export function apiCatalog(origin: string, cliVersion?: string) {
  const api = at(origin, AGENT_API);
  return {
    linkset: [
      { anchor: at(origin, '/.well-known/api-catalog'), item: [{ href: api }] },
      {
        anchor: api,
        'service-desc': [{ href: at(origin, '/openapi.json'), type: 'application/json' }],
        'service-doc': [
          { href: at(origin, '/guide'), type: 'text/html' },
          ...(cliVersion
            ? [{ href: at(origin, '/agent-setup/prompt.md'), type: 'text/markdown' }]
            : []),
        ],
        status: [{ href: at(origin, '/health'), type: 'application/json' }],
      },
    ],
  };
}

export function agentSkill(origin: string, cliVersion: string) {
  const markdown = [
    '---',
    `name: ${AGENT_SKILL_NAME}`,
    // A JSON string is a valid YAML double-quoted scalar, so the colons stay safe.
    `description: ${JSON.stringify(AGENT_SKILL_DESCRIPTION)}`,
    '---',
    '',
    agentInstructions(origin, cliVersion),
  ].join('\n');
  return {
    name: AGENT_SKILL_NAME,
    description: AGENT_SKILL_DESCRIPTION,
    markdown,
    digest: `sha256:${createHash('sha256').update(markdown, 'utf8').digest('hex')}`,
  };
}

export function agentSkillsIndex(origin: string, cliVersion: string) {
  const skill = agentSkill(origin, cliVersion);
  return {
    $schema: AGENT_SKILLS_SCHEMA,
    skills: [
      {
        name: skill.name,
        type: 'skill-md',
        description: skill.description,
        url: `/.well-known/agent-skills/${skill.name}/SKILL.md`,
        digest: skill.digest,
      },
    ],
  };
}
