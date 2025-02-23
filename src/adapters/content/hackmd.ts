import type { ContentProvider } from '../../types';

interface HackMdNote {
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

interface HackMdResponse {
  user: {
    name: string;
    userpath: string;
    biography: string;
    photo: string;
  };
  notes: HackMdNote[];
}

export class HackMdProvider implements ContentProvider {
  constructor(private username: string) {}

  async getContents() {
    try {
      const response = await fetch(`https://hackmd.io/api/@${this.username}/overview`);
      if (!response.ok) {
        throw new Error(`Failed to fetch HackMD content: ${response.statusText}`);
      }

      const data = await response.json() as HackMdResponse;
      const posts = data.notes
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
        author: {
          name: data.user.name,
          bio: data.user.biography,
        },
      };
    } catch (error) {
      console.error('Error fetching HackMD content:', error);
      throw error;
    }
  }
}
