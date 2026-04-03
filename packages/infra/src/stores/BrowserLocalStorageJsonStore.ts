import type { JsonStore } from '@my-stocks/domain';

export class BrowserLocalStorageJsonStore implements JsonStore {
  constructor(private readonly prefix = 'my-stocks:') {}

  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(this.prefixedKey(key));
  }

  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(this.prefixedKey(key), value);
  }

  private prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}
