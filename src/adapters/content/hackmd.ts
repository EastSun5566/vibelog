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
  user?: {
    name: string;
    userpath: string;
    biography: string;
    photo: string;
  };
  team?: {
    name: string;
    description: string;
  }
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

      const { notes, user, team } = await response.json() as HackMdResponse;
      const posts = notes
        .filter(note => note.publishType === 'view' && note.publishedAt)
        .map(note => ({
          id: note.id,
          title: note.title,
          content: note.content,
          slug: note.permalink ?? note.title,
          date: new Date(note.publishedAt).toISOString(),
        }));

      const author = {
        name: user?.name ?? team?.name ?? '',
        bio: user?.biography ?? team?.description ?? '',
      };

      return {
        posts,
        author,
      };
    } catch (error) {
      console.error('Error fetching HackMD content:', error);
      throw error;
    }
  }
}
