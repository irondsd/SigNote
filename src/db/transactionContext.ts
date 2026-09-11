import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from './client';

export const accountTransaction = new AsyncLocalStorage<{ db: Db; users: Set<string> }>();
export const requestGeneration = new AsyncLocalStorage<number | undefined>();
