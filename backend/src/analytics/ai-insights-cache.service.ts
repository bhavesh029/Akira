import { Injectable } from '@nestjs/common';

/** In-memory cache for dashboard AI insights; invalidated when the user's transactions change. */
@Injectable()
export class AiInsightsCacheService {
  private readonly prefix = 'ai-insights';
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  /** Fallback TTL so entries do not live forever if invalidation is missed (7 days). */
  private readonly defaultTtlMs = 7 * 24 * 60 * 60 * 1000;

  makeKey(userId: number, accountId?: number, dateRange?: string): string {
    const acc = accountId ?? 'all';
    const dr = dateRange ?? 'all';
    return `${this.prefix}:${userId}:${acc}:${dr}`;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Remove all cached AI insight entries for a user (any account / date range). */
  invalidateForUser(userId: number): void {
    const p = `${this.prefix}:${userId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(p)) this.store.delete(key);
    }
  }
}
