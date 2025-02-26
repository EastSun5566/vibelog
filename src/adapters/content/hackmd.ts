import type { ContentProvider } from '../../types';
import { logger } from '../../core';

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
  constructor(private username: string) {
    logger.info(`Content provider: HackMD (${username})`);
  }

  async getPosts() {
    try {
      const response = await fetch(`${BASE_URL}/api/@${this.username}/overview`);
      if (!response.ok) {
        throw new Error(`Failed to fetch HackMD content: ${response.statusText}`);
      }

      const { notes } = await response.json() as NotesResponse;
      const posts = notes
        .filter(note => note.publishType === 'view' && note.publishedAt)
        .map(note => ({
          id: note.id,
          title: note.title,
          content: note.content,
          slug: note.permalink ?? note.title,
          date: new Date(note.publishedAt).toISOString(),
        }));

      return {
        posts,
      };
    } catch (error) {
      logger.error('Error fetching HackMD content:', error);
      throw error;
    }
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
