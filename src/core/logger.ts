import { red, blue, dim } from 'kleur/colors';

export type LoggerLevel = 'info' | 'error';

export class Logger {
  constructor(private level: LoggerLevel = 'info') {}

  info(...messages: unknown[]) {
    if (this.level === 'info') {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`${dim(timestamp)} ${blue('[vibe] [INFO]')}`, ...messages);
    }
  }

  error(...messages: unknown[]) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${dim(timestamp)} ${red('[vibe] [ERROR]')}`, ...messages);
  }

}

export const logger = new Logger();
