import { red, blue, dim } from 'kleur/colors';

export class Logger {
  constructor(private silent = false) {}

  private getTime() {
    return new Date().toLocaleTimeString();
  }

  info(...messages: unknown[]) {
    if (!this.silent) {
      console.info(`${dim(this.getTime())} ${blue('[vibelog] ℹ')}`, ...messages);
    }
  }

  error(...messages: unknown[]) {
    if (!this.silent) {
      console.error(`${dim(this.getTime())} ${red('[vibelog] ❌')}`, ...messages);
    }
  }

  warn(...messages: unknown[]) {
    if (!this.silent) {
      console.warn(`${dim(this.getTime())} ${blue('[vibelog] ⚠️')}`, ...messages);
    }
  }
}

export const logger = new Logger();
export const createLogger = (silent = false) => new Logger(silent);
