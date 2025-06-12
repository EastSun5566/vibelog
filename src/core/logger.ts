import { red, blue, dim } from 'kleur/colors';

export class Logger {
  private getTime() {
    return new Date().toLocaleTimeString();
  }

  info(...messages: unknown[]) {
    console.info(`${dim(this.getTime())} ${blue('[vibelog] ℹ')}`, ...messages);
  }

  error(...messages: unknown[]) {
    console.error(`${dim(this.getTime())} ${red('[vibelog] ❌')}`, ...messages);
  }

  warn(...messages: unknown[]) {
    console.warn(`${dim(this.getTime())} ${blue('[vibelog] ⚠️')}`, ...messages);
  }
}

export const logger = new Logger();
