import type { JsonStore } from '../repositories';

export class InMemoryJsonStore implements JsonStore {
  private readonly memory = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.memory.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.memory.set(key, value);
  }
}
