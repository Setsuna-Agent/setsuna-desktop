import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../ports/id-generator.js';

export class RandomIdGenerator implements IdGenerator {
  id(prefix: string): string {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  }
}

