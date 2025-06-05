import { join } from 'node:path';
import fs from 'fs-extra';

import { logger } from './logger';
import type { Author, Post } from '../types';

export interface VibeState {
  lastModifiedCss?: string;
  contentSnapshot?: {
    posts: Post[];
    author: Author;
    fetchedAt: string;
  };
  // metadata?: {
  //   lastDevRun?: string;
  //   lastBuild?: string;
  // };
}
export class StateManager {
  private stateDir: string;
  private statePath: string;

  constructor(root: string = process.cwd()) {
    this.stateDir = join(root, '.vibelog');
    this.statePath = join(this.stateDir, 'state.json');
  }

  async ensureStateDir() {
    await fs.ensureDir(this.stateDir);
  }

  async loadState(): Promise<VibeState> {
    try {
      await this.ensureStateDir();
      if (await fs.pathExists(this.statePath)) {
        const state = await fs.readJson(this.statePath) as VibeState;
        return state;
      }
    } catch (error) {
      logger.warn('Failed to load state:', error);
    }
    return {};
  }

  async saveState(state: VibeState) {
    try {
      await this.ensureStateDir();

      // if (!state.metadata) state.metadata = {};
      // state.metadata.lastDevRun = new Date().toISOString();

      await fs.writeJson(this.statePath, state, { spaces: 2 });
      logger.info('State saved successfully');
    } catch (error) {
      logger.error('Failed to save state:', error);
    }
  }

  async saveCss(css: string) {
    const state = await this.loadState();
    state.lastModifiedCss = css;

    await this.saveState(state);
  }

  async getLastCss(): Promise<string | null> {
    const state = await this.loadState();
    return state.lastModifiedCss ?? null;
  }

  async saveContentSnapshot(
    posts: Post[],
    author: Author,
  ) {
    const state = await this.loadState();
    state.contentSnapshot = {
      posts,
      author,
      fetchedAt: new Date().toISOString(),
    };
    await this.saveState(state);
  }

  async markBuildCompleted() {
    const state = await this.loadState();
    // if (!state.metadata) state.metadata = {};
    // state.metadata.lastBuild = new Date().toISOString();
    await this.saveState(state);
  }

  async clearState() {
    try {
      await fs.remove(this.stateDir);
      logger.info('State cleared');
    } catch (error) {
      logger.warn('Failed to clear state:', error);
    }
  }
}
