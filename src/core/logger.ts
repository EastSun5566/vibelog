import { red, blue, dim } from 'kleur/colors';

export class Logger {
  private getTime() {
    return new Date().toLocaleTimeString();
  }

  info(...messages: unknown[]) {
    console.log(`${dim(this.getTime())} ${blue('[vibe] [INFO]')}`, ...messages);
  }

  error(...messages: unknown[]) {
    console.log(`${dim(this.getTime())} ${red('[vibe] [ERROR]')}`, ...messages);
  }

  warn(...messages: unknown[]) {
    console.log(`${dim(this.getTime())} ${blue('[vibe] [WARN]')}`, ...messages);
  }
}

export const logger = new Logger();
