import assert from 'node:assert/strict';

import type { ContentProvider } from '../../types';
import { logger } from '../../core';
import { ContentProviderName } from '../../consts';

interface Note {
  id: string;
  shortid: string;
  title: string;
  content: string;
  tags: string[];
  lastchangeAt: string;
  createdAt: string;
  publishType: string;
  publishedAt: string;
  permalink?: string;
}
interface NotesResponse {
  notes: Note[];
}

interface User {
  displayName: string;
  photo: string;
  biography: string;
}

interface Team {
  name: string;
  logo: string;
  description: string;
}
interface ProfileResponse {
  user?: User;
  team?: Team;
}

const BASE_URL = 'https://hackmd.io';

export class HackMdProvider implements ContentProvider {
  readonly name = ContentProviderName.HACKMD;
  constructor(readonly username: string) {
    logger.info(`Content provider: HackMD (${username})`);

    assert(username, 'HackMD username is required. Use hackmd@<username>');
  }

  async getPosts() {
    const response = await fetch(`${BASE_URL}/api/@${this.username}/overview`);
    if (!response.ok) {
      throw new Error(`Failed to fetch HackMD content: ${response.statusText}`);
    }

    const { notes } = await response.json() as NotesResponse;
    const posts = await Promise.all(notes
      .filter(note => note.publishType === 'view' && note.publishedAt)
      .map(async note => {
        const response = await fetch(`${BASE_URL}/${note.id}/download`);
        if (!response.ok) {
          throw new Error(`Failed to fetch the content for note ${note.id}: ${response.statusText}`);
        }
        const content = await response.text();

        return {
          id: note.id,
          title: note.title,
          content,
          slug: note.permalink ?? note.title,
          date: new Date(note.publishedAt).toISOString(),
        };
      }));

    return {
      posts,
    };
  }

  async getAuthor() {
    const response = await fetch(`${BASE_URL}/info/@${this.username}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch HackMD profile: ${response.statusText}`);
    }

    const { user, team } = await response.json() as ProfileResponse;
    return {
      name: user?.displayName ?? team?.name ?? 'Unknown',
      bio: user?.biography ?? team?.description ?? '',
    };
  }
}
