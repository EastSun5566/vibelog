import assert from 'node:assert/strict';
import {
  Client,
  APIErrorCode,
  isNotionClientError,
  isFullPage,
  collectPaginatedAPI,
  type PageObjectResponse,
} from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';

import { logger, slugify } from '../../core/index.js';
import { ContentSourceName } from '../../consts.js';
import { removeFirstH1IfMatchesTitle } from './utils.js';
import type { ContentSource } from '../../types.js';

export class NotionSource implements ContentSource {
  readonly name = ContentSourceName.NOTION;
  private notion: Client;
  private n2m: NotionToMarkdown;

  constructor(readonly databaseId: string, options: { token?: string } = {}) {
    logger.info(`Content source: Notion (${databaseId})`);

    assert(databaseId, 'Notion database ID is required. Use notion@<database_id>');
    const token = options.token ?? process.env.NOTION_TOKEN;
    assert(token, 'A Notion token is required. Pass token or set NOTION_TOKEN.');

    this.notion = new Client({
      auth: token,
    });
    this.n2m = new NotionToMarkdown({
      notionClient: this.notion,
    });
  }

  async getPosts() {
    try {
      const allPages = await collectPaginatedAPI(
        this.notion.databases.query,
        {
          database_id: this.databaseId,
        },
      );

      const posts = await Promise.all(
        allPages
          .filter(isFullPage)
          .map(async (page) => {
            const mdBlocks = await this.n2m.pageToMarkdown(page.id);
            const content = this.n2m.toMarkdownString(mdBlocks);

            const title = this.extractTitle(page.properties) ?? 'Untitled';
            const date = this.extractDate(page.properties) ?? page.created_time;

            return {
              id: page.id,
              title,
              content: removeFirstH1IfMatchesTitle(content.parent, title),
              slug: slugify(title),
              date: new Date(date).toISOString(),
            };
          }),
      );

      return { posts };
    } catch (error: unknown) {
      if (isNotionClientError(error)) {
        switch (error.code) {
        case APIErrorCode.ObjectNotFound:
          throw new Error(`Notion database not found: ${this.databaseId}. Make sure the database exists and your integration has access to it.`);
        case APIErrorCode.Unauthorized:
          throw new Error('Invalid Notion token or insufficient permissions. Check your NOTION_TOKEN and integration permissions.');
        case APIErrorCode.ValidationError:
          throw new Error(`Invalid database ID format: ${this.databaseId}`);
        default:
          throw new Error(`Notion API error: ${error.message}`);
        }
      }

      throw error;
    }
  }

  async getAuthor() {
    const database = await this.notion.databases.retrieve({
      database_id: this.databaseId,
    });

    let authorName = '';

    if ('created_by' in database && database.created_by.id) {
      try {
        const creator = await this.notion.users.retrieve({
          user_id: database.created_by.id,
        });
        authorName = creator.name ?? 'Unknown';
      } catch { /* empty */ }
    }

    return {
      name: authorName,
      bio: 'title' in database ? database.title[0]?.plain_text ?? '' : '',
    };
  }

  private extractTitle(properties: PageObjectResponse['properties']): string | null {
    for (const [, property] of Object.entries(properties)) {
      if (property.type === 'title' && property.title[0]?.plain_text) {
        return property.title[0].plain_text;
      }
    }

    return null;
  }

  private extractDate(properties: PageObjectResponse['properties']): string | null {
    for (const [, property] of Object.entries(properties)) {
      if (property.type === 'date' && property.date?.start) {
        return property.date.start;
      }
    }

    return null;
  }
}
