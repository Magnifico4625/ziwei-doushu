import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { getServerConfig } from './env';
import type { EntitlementScope } from './access-token';

export interface StoredOrder {
  orderId: string;
  scope: EntitlementScope;
  targetKey: string;
  status: string;
  amountMinor?: number;
  currency?: string;
  provider?: string;
  checkoutUrl?: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
  paidAt?: Date;
  updatedAt?: Date;
}

export type PaymentOrderRecord = StoredOrder;

export interface CreatePendingOrderInput {
  orderId?: string;
  scope: EntitlementScope;
  targetKey: string;
  amountMinor?: number;
  currency?: string;
  provider?: string;
  checkoutUrl?: string;
  meta?: Record<string, unknown>;
}

export interface CachedInterpretation {
  cacheKey: string;
  topicKey: string;
  content: string;
  provider?: string;
  model?: string;
  createdAt: Date;
}

export interface CachedSynastry {
  pairKey: string;
  questionHash: string;
  content: string;
  provider?: string;
  model?: string;
  createdAt: Date;
}

export interface WebhookEventRecord {
  eventId: string;
  provider?: string;
  orderId: string;
  processedAt: Date;
}

export interface RecordWebhookOrderInput {
  eventId: string;
  orderId: string;
  scope: EntitlementScope;
  targetKey: string;
  status?: string;
  amountMinor?: number;
  currency?: string;
  provider?: string;
  checkoutUrl?: string;
  meta?: Record<string, unknown>;
}

export type MarkOrderPaidInput = Omit<RecordWebhookOrderInput, 'eventId'> & {
  eventId?: string;
};

export type SaveChartInterpretationInput = Omit<
  CachedInterpretation,
  'createdAt' | 'topicKey'
> & {
  topicKey?: string;
};

export type SaveSynastryInterpretationInput = Omit<
  CachedSynastry,
  'createdAt' | 'questionHash'
> & {
  questionHash?: string;
};

export interface DatabaseAdapter {
  createPendingOrder(input: CreatePendingOrderInput): Promise<PaymentOrderRecord>;
  getOrder(orderId: string): Promise<PaymentOrderRecord | null>;
  recordWebhookOrderIfNew(
    input: RecordWebhookOrderInput,
  ): Promise<{ inserted: boolean; order: PaymentOrderRecord }>;
  markOrderPaidAndGrant(
    input: MarkOrderPaidInput,
  ): Promise<{ inserted: boolean; order: PaymentOrderRecord }>;
  hasPaidEntitlement(scope: EntitlementScope, targetKey: string): Promise<boolean>;
  getChartInterpretation(
    cacheKey: string,
    topicKey?: string,
  ): Promise<CachedInterpretation | null>;
  saveChartInterpretation(entry: SaveChartInterpretationInput): Promise<void>;
  getSynastryInterpretation(
    pairKey: string,
    questionHash?: string,
  ): Promise<CachedSynastry | null>;
  saveSynastryInterpretation(entry: SaveSynastryInterpretationInput): Promise<void>;
  checkHealth(): Promise<{ ok: boolean; mode: 'postgres' | 'memory' }>;
}

interface OrderRow extends QueryResultRow {
  order_id: string;
  scope: string;
  target_key: string;
  status: string;
  amount_minor: number | null;
  currency: string | null;
  provider: string | null;
  checkout_url: string | null;
  meta: unknown;
  created_at: Date | string;
  paid_at: Date | string | null;
  updated_at: Date | string | null;
}

interface ChartInterpretationRow extends QueryResultRow {
  cache_key: string;
  topic_key: string;
  content: string;
  provider: string | null;
  model: string | null;
  created_at: Date | string;
}

interface SynastryInterpretationRow extends QueryResultRow {
  pair_key: string;
  question_hash: string;
  content: string;
  provider: string | null;
  model: string | null;
  created_at: Date | string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const serialized = JSON.stringify(meta);
  if (serialized === undefined) return undefined;
  const parsed: unknown = JSON.parse(serialized);
  return isPlainRecord(parsed) ? parsed : undefined;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function isEntitlementScope(value: unknown): value is EntitlementScope {
  return value === 'interpret' || value === 'heming' || value === 'bundle';
}

function parseEntitlementScope(value: string): EntitlementScope {
  if (isEntitlementScope(value)) {
    return value;
  }
  throw new Error(`Unexpected order scope in database: ${value}`);
}

function normalizeTopicKey(topicKey?: string): string {
  const trimmed = topicKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'default';
}

function normalizeQuestionHash(questionHash?: string): string {
  return questionHash ?? '';
}

function matchingScopesFor(scope: EntitlementScope): readonly EntitlementScope[] {
  if (scope === 'interpret' || scope === 'heming') {
    return [scope, 'bundle'];
  }
  return [scope];
}

function isEntitlementMatch(
  order: Pick<StoredOrder, 'scope' | 'targetKey' | 'status'>,
  requestedScope: EntitlementScope,
  targetKey: string,
): boolean {
  if (order.status !== 'paid' || order.targetKey !== targetKey) {
    return false;
  }
  return matchingScopesFor(requestedScope).includes(order.scope);
}

function cloneOrder(order: StoredOrder): StoredOrder {
  return {
    orderId: order.orderId,
    scope: order.scope,
    targetKey: order.targetKey,
    status: order.status,
    ...(order.amountMinor !== undefined ? { amountMinor: order.amountMinor } : {}),
    ...(order.currency !== undefined ? { currency: order.currency } : {}),
    ...(order.provider !== undefined ? { provider: order.provider } : {}),
    ...(order.checkoutUrl !== undefined ? { checkoutUrl: order.checkoutUrl } : {}),
    ...(order.meta !== undefined ? { meta: cloneMeta(order.meta) } : {}),
    createdAt: new Date(order.createdAt.getTime()),
    ...(order.paidAt !== undefined ? { paidAt: new Date(order.paidAt.getTime()) } : {}),
    ...(order.updatedAt !== undefined ? { updatedAt: new Date(order.updatedAt.getTime()) } : {}),
  };
}

function cloneChartInterpretation(entry: CachedInterpretation): CachedInterpretation {
  return {
    cacheKey: entry.cacheKey,
    topicKey: entry.topicKey,
    content: entry.content,
    ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    createdAt: new Date(entry.createdAt.getTime()),
  };
}

function cloneSynastryInterpretation(entry: CachedSynastry): CachedSynastry {
  return {
    pairKey: entry.pairKey,
    questionHash: entry.questionHash,
    content: entry.content,
    ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    createdAt: new Date(entry.createdAt.getTime()),
  };
}

function mapOrderRow(row: OrderRow): StoredOrder {
  const meta = isPlainRecord(row.meta) ? cloneMeta(row.meta) : undefined;
  return {
    orderId: row.order_id,
    scope: parseEntitlementScope(row.scope),
    targetKey: row.target_key,
    status: row.status,
    ...(row.amount_minor !== null ? { amountMinor: row.amount_minor } : {}),
    ...(row.currency !== null ? { currency: row.currency } : {}),
    ...(row.provider !== null ? { provider: row.provider } : {}),
    ...(row.checkout_url !== null ? { checkoutUrl: row.checkout_url } : {}),
    ...(meta !== undefined ? { meta } : {}),
    createdAt: toDate(row.created_at),
    ...(row.paid_at !== null ? { paidAt: toDate(row.paid_at) } : {}),
    ...(row.updated_at !== null ? { updatedAt: toDate(row.updated_at) } : {}),
  };
}

function mapChartRow(row: ChartInterpretationRow): CachedInterpretation {
  return {
    cacheKey: row.cache_key,
    topicKey: row.topic_key,
    content: row.content,
    ...(row.provider !== null ? { provider: row.provider } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    createdAt: toDate(row.created_at),
  };
}

function mapSynastryRow(row: SynastryInterpretationRow): CachedSynastry {
  return {
    pairKey: row.pair_key,
    questionHash: row.question_hash,
    content: row.content,
    ...(row.provider !== null ? { provider: row.provider } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    createdAt: toDate(row.created_at),
  };
}

function generateOrderId(): string {
  return `ord_${randomUUID().replace(/-/g, '')}`;
}

function validateCreatePendingOrderInput(input: CreatePendingOrderInput): {
  orderId: string;
  targetKey: string;
} {
  if (!isEntitlementScope(input.scope)) {
    throw new Error(`Invalid entitlement scope: ${String(input.scope)}`);
  }
  const targetKey = input.targetKey.trim();
  if (!targetKey) {
    throw new Error('order targetKey must be non-empty');
  }
  if (input.orderId !== undefined && !input.orderId.trim()) {
    throw new Error('orderId must be non-empty when provided');
  }
  if (
    input.amountMinor !== undefined &&
    (!Number.isInteger(input.amountMinor) || input.amountMinor < 0)
  ) {
    throw new Error('amountMinor must be a non-negative integer');
  }
  return {
    orderId: input.orderId?.trim() || generateOrderId(),
    targetKey,
  };
}

function validateRecordWebhookInput(input: RecordWebhookOrderInput): void {
  if (!input.eventId.trim()) {
    throw new Error('webhook eventId must be non-empty');
  }
  if (!input.orderId.trim()) {
    throw new Error('webhook orderId must be non-empty');
  }
  if (!input.targetKey.trim()) {
    throw new Error('webhook targetKey must be non-empty');
  }
  if (!isEntitlementScope(input.scope)) {
    throw new Error(`Invalid entitlement scope: ${String(input.scope)}`);
  }
}

export class InMemoryDbStore {
  readonly webhookEvents = new Map<string, WebhookEventRecord>();
  readonly orders = new Map<string, StoredOrder>();
  readonly chartInterpretations = new Map<string, CachedInterpretation>();
  readonly synastryInterpretations = new Map<string, CachedSynastry>();

  reset(): void {
    this.webhookEvents.clear();
    this.orders.clear();
    this.chartInterpretations.clear();
    this.synastryInterpretations.clear();
  }

  createPendingOrder(input: CreatePendingOrderInput): StoredOrder {
    const { orderId, targetKey } = validateCreatePendingOrderInput(input);
    const existing = this.orders.get(orderId);
    if (existing) {
      if (
        existing.status === 'pending' &&
        existing.scope === input.scope &&
        existing.targetKey === targetKey
      ) {
        return cloneOrder(existing);
      }
      throw new Error(`Order already exists: ${orderId}`);
    }

    const now = new Date();
    const order: StoredOrder = {
      orderId,
      scope: input.scope,
      targetKey,
      status: 'pending',
      ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.checkoutUrl !== undefined ? { checkoutUrl: input.checkoutUrl } : {}),
      ...(input.meta !== undefined ? { meta: cloneMeta(input.meta) } : {}),
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(orderId, order);
    return cloneOrder(order);
  }

  getOrder(orderId: string): StoredOrder | null {
    const trimmed = orderId.trim();
    if (!trimmed) return null;
    const hit = this.orders.get(trimmed);
    return hit ? cloneOrder(hit) : null;
  }

  recordWebhookOrderIfNew(
    input: RecordWebhookOrderInput,
  ): { inserted: boolean; order: StoredOrder } {
    const existingEvent = this.webhookEvents.get(input.eventId);
    if (existingEvent) {
      const existingOrder =
        this.orders.get(existingEvent.orderId) ?? this.orders.get(input.orderId);
      if (existingOrder) {
        return { inserted: false, order: cloneOrder(existingOrder) };
      }
      const fallbackOrder: StoredOrder = {
        orderId: existingEvent.orderId,
        scope: input.scope,
        targetKey: input.targetKey,
        status: input.status?.trim() || 'paid',
        ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.checkoutUrl !== undefined ? { checkoutUrl: input.checkoutUrl } : {}),
        ...(input.meta !== undefined ? { meta: cloneMeta(input.meta) } : {}),
        createdAt: new Date(existingEvent.processedAt.getTime()),
        paidAt: new Date(existingEvent.processedAt.getTime()),
        updatedAt: new Date(existingEvent.processedAt.getTime()),
      };
      return { inserted: false, order: fallbackOrder };
    }

    const now = new Date();
    const nextStatus = input.status?.trim() || 'paid';
    const nextPaidAt = nextStatus === 'paid' ? now : undefined;

    this.webhookEvents.set(input.eventId, {
      eventId: input.eventId,
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      orderId: input.orderId,
      processedAt: now,
    });

    const previousOrder = this.orders.get(input.orderId);
    const alreadyPaid = previousOrder?.status === 'paid';
    const mergedOrder: StoredOrder = previousOrder
      ? {
          orderId: previousOrder.orderId,
          scope: alreadyPaid ? previousOrder.scope : input.scope,
          targetKey: alreadyPaid ? previousOrder.targetKey : input.targetKey,
          status: alreadyPaid ? 'paid' : nextStatus,
          ...(input.amountMinor !== undefined
            ? { amountMinor: input.amountMinor }
            : previousOrder.amountMinor !== undefined
              ? { amountMinor: previousOrder.amountMinor }
              : {}),
          ...(input.currency !== undefined
            ? { currency: input.currency }
            : previousOrder.currency !== undefined
              ? { currency: previousOrder.currency }
              : {}),
          ...(input.provider !== undefined
            ? { provider: input.provider }
            : previousOrder.provider !== undefined
              ? { provider: previousOrder.provider }
              : {}),
          ...(input.checkoutUrl !== undefined
            ? { checkoutUrl: input.checkoutUrl }
            : previousOrder.checkoutUrl !== undefined
              ? { checkoutUrl: previousOrder.checkoutUrl }
              : {}),
          ...(input.meta !== undefined
            ? { meta: cloneMeta(input.meta) }
            : previousOrder.meta !== undefined
              ? { meta: cloneMeta(previousOrder.meta) }
              : {}),
          createdAt: new Date(previousOrder.createdAt.getTime()),
          ...(previousOrder.paidAt !== undefined
            ? { paidAt: new Date(previousOrder.paidAt.getTime()) }
            : nextPaidAt !== undefined
              ? { paidAt: nextPaidAt }
              : {}),
          updatedAt: now,
        }
      : {
          orderId: input.orderId,
          scope: input.scope,
          targetKey: input.targetKey,
          status: nextStatus,
          ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.provider !== undefined ? { provider: input.provider } : {}),
          ...(input.checkoutUrl !== undefined ? { checkoutUrl: input.checkoutUrl } : {}),
          ...(input.meta !== undefined ? { meta: cloneMeta(input.meta) } : {}),
          createdAt: now,
          ...(nextPaidAt !== undefined ? { paidAt: nextPaidAt } : {}),
          updatedAt: now,
        };

    this.orders.set(input.orderId, mergedOrder);
    return { inserted: true, order: cloneOrder(mergedOrder) };
  }

  hasPaidEntitlement(scope: EntitlementScope, targetKey: string): boolean {
    if (!targetKey) return false;
    for (const order of this.orders.values()) {
      if (isEntitlementMatch(order, scope, targetKey)) {
        return true;
      }
    }
    return false;
  }

  getChartInterpretation(
    cacheKey: string,
    topicKey?: string,
  ): CachedInterpretation | null {
    if (!cacheKey) return null;
    const key = `${cacheKey}\0${normalizeTopicKey(topicKey)}`;
    const hit = this.chartInterpretations.get(key);
    return hit ? cloneChartInterpretation(hit) : null;
  }

  saveChartInterpretation(entry: SaveChartInterpretationInput): void {
    const resolvedTopic = normalizeTopicKey(entry.topicKey);
    const key = `${entry.cacheKey}\0${resolvedTopic}`;
    this.chartInterpretations.set(key, {
      cacheKey: entry.cacheKey,
      topicKey: resolvedTopic,
      content: entry.content,
      ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
      ...(entry.model !== undefined ? { model: entry.model } : {}),
      createdAt: new Date(),
    });
  }

  getSynastryInterpretation(
    pairKey: string,
    questionHash?: string,
  ): CachedSynastry | null {
    if (!pairKey) return null;
    const key = `${pairKey}\0${normalizeQuestionHash(questionHash)}`;
    const hit = this.synastryInterpretations.get(key);
    return hit ? cloneSynastryInterpretation(hit) : null;
  }

  saveSynastryInterpretation(entry: SaveSynastryInterpretationInput): void {
    const resolvedHash = normalizeQuestionHash(entry.questionHash);
    const key = `${entry.pairKey}\0${resolvedHash}`;
    this.synastryInterpretations.set(key, {
      pairKey: entry.pairKey,
      questionHash: resolvedHash,
      content: entry.content,
      ...(entry.provider !== undefined ? { provider: entry.provider } : {}),
      ...(entry.model !== undefined ? { model: entry.model } : {}),
      createdAt: new Date(),
    });
  }
}

export class MemoryDatabaseAdapter implements DatabaseAdapter {
  private readonly store: InMemoryDbStore;

  constructor(store: InMemoryDbStore = new InMemoryDbStore()) {
    this.store = store;
  }

  async createPendingOrder(input: CreatePendingOrderInput): Promise<PaymentOrderRecord> {
    return this.store.createPendingOrder(input);
  }

  async getOrder(orderId: string): Promise<PaymentOrderRecord | null> {
    return this.store.getOrder(orderId);
  }

  async recordWebhookOrderIfNew(
    input: RecordWebhookOrderInput,
  ): Promise<{ inserted: boolean; order: PaymentOrderRecord }> {
    validateRecordWebhookInput(input);
    return this.store.recordWebhookOrderIfNew(input);
  }

  async markOrderPaidAndGrant(
    input: MarkOrderPaidInput,
  ): Promise<{ inserted: boolean; order: PaymentOrderRecord }> {
    const eventId = input.eventId?.trim() || `order-paid:${input.orderId.trim()}`;
    return this.recordWebhookOrderIfNew({
      ...input,
      eventId,
      status: 'paid',
    });
  }

  async hasPaidEntitlement(scope: EntitlementScope, targetKey: string): Promise<boolean> {
    if (!targetKey || !isEntitlementScope(scope)) {
      return false;
    }
    return this.store.hasPaidEntitlement(scope, targetKey);
  }

  async getChartInterpretation(
    cacheKey: string,
    topicKey?: string,
  ): Promise<CachedInterpretation | null> {
    return this.store.getChartInterpretation(cacheKey, topicKey);
  }

  async saveChartInterpretation(entry: SaveChartInterpretationInput): Promise<void> {
    if (!entry.cacheKey.trim()) {
      throw new Error('cacheKey must be non-empty');
    }
    if (typeof entry.content !== 'string') {
      throw new Error('interpretation content must be a string');
    }
    this.store.saveChartInterpretation(entry);
  }

  async getSynastryInterpretation(
    pairKey: string,
    questionHash?: string,
  ): Promise<CachedSynastry | null> {
    return this.store.getSynastryInterpretation(pairKey, questionHash);
  }

  async saveSynastryInterpretation(entry: SaveSynastryInterpretationInput): Promise<void> {
    if (!entry.pairKey.trim()) {
      throw new Error('pairKey must be non-empty');
    }
    if (typeof entry.content !== 'string') {
      throw new Error('synastry content must be a string');
    }
    this.store.saveSynastryInterpretation(entry);
  }

  async checkHealth(): Promise<{ ok: boolean; mode: 'postgres' | 'memory' }> {
    return { ok: true, mode: 'memory' };
  }
}

export class PostgresDatabaseAdapter implements DatabaseAdapter {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async createPendingOrder(input: CreatePendingOrderInput): Promise<PaymentOrderRecord> {
    const { orderId, targetKey } = validateCreatePendingOrderInput(input);
    const serializedMeta = input.meta !== undefined ? JSON.stringify(cloneMeta(input.meta)) : null;

    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query<OrderRow>(
        `INSERT INTO orders (
           order_id, scope, target_key, status, amount_minor,
           currency, provider, checkout_url, meta, created_at, paid_at, updated_at
         )
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8::jsonb, NOW(), NULL, NOW())
         ON CONFLICT (order_id) DO NOTHING
         RETURNING order_id, scope, target_key, status, amount_minor,
                   currency, provider, checkout_url, meta, created_at, paid_at, updated_at`,
        [
          orderId,
          input.scope,
          targetKey,
          input.amountMinor ?? null,
          input.currency ?? null,
          input.provider ?? null,
          input.checkoutUrl ?? null,
          serializedMeta,
        ],
      );

      if (inserted.rows[0]) {
        return mapOrderRow(inserted.rows[0]);
      }

      const existingRes = await client.query<OrderRow>(
        `SELECT order_id, scope, target_key, status, amount_minor,
                currency, provider, checkout_url, meta, created_at, paid_at, updated_at
         FROM orders
         WHERE order_id = $1
         LIMIT 1`,
        [orderId],
      );
      const existing = existingRes.rows[0];
      if (
        existing &&
        existing.status === 'pending' &&
        existing.scope === input.scope &&
        existing.target_key === targetKey
      ) {
        return mapOrderRow(existing);
      }

      throw new Error(`Order already exists: ${orderId}`);
    });
  }

  async getOrder(orderId: string): Promise<PaymentOrderRecord | null> {
    const trimmed = orderId.trim();
    if (!trimmed) return null;

    const result = await this.pool.query<OrderRow>(
      `SELECT order_id, scope, target_key, status, amount_minor,
              currency, provider, checkout_url, meta, created_at, paid_at, updated_at
       FROM orders
       WHERE order_id = $1
       LIMIT 1`,
      [trimmed],
    );
    return result.rows[0] ? mapOrderRow(result.rows[0]) : null;
  }

  async recordWebhookOrderIfNew(
    input: RecordWebhookOrderInput,
  ): Promise<{ inserted: boolean; order: PaymentOrderRecord }> {
    validateRecordWebhookInput(input);

    const nextStatus = input.status?.trim() || 'paid';
    const paidAt = nextStatus === 'paid' ? new Date() : null;
    const serializedMeta = input.meta !== undefined ? JSON.stringify(cloneMeta(input.meta)) : null;

    return withTransaction(this.pool, async (client) => {
      const eventInsert = await client.query<{ event_id: string }>(
        `INSERT INTO webhook_events (event_id, provider, order_id, processed_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [input.eventId, input.provider ?? null, input.orderId],
      );

      if (eventInsert.rowCount === 0) {
        const existingOrderRes = await client.query<OrderRow>(
          `SELECT o.order_id, o.scope, o.target_key, o.status, o.amount_minor,
                  o.currency, o.provider, o.checkout_url, o.meta, o.created_at, o.paid_at, o.updated_at
           FROM webhook_events w
           JOIN orders o ON o.order_id = w.order_id
           WHERE w.event_id = $1
           LIMIT 1`,
          [input.eventId],
        );
        if (existingOrderRes.rows[0]) {
          return { inserted: false, order: mapOrderRow(existingOrderRes.rows[0]) };
        }

        const fallbackOrderRes = await client.query<OrderRow>(
          `SELECT order_id, scope, target_key, status, amount_minor,
                  currency, provider, checkout_url, meta, created_at, paid_at, updated_at
           FROM orders
           WHERE order_id = $1
           LIMIT 1`,
          [input.orderId],
        );
        if (fallbackOrderRes.rows[0]) {
          return { inserted: false, order: mapOrderRow(fallbackOrderRes.rows[0]) };
        }

        return {
          inserted: false,
          order: {
            orderId: input.orderId,
            scope: input.scope,
            targetKey: input.targetKey,
            status: nextStatus,
            ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
            ...(input.currency !== undefined ? { currency: input.currency } : {}),
            ...(input.provider !== undefined ? { provider: input.provider } : {}),
            ...(input.checkoutUrl !== undefined ? { checkoutUrl: input.checkoutUrl } : {}),
            ...(input.meta !== undefined ? { meta: cloneMeta(input.meta) } : {}),
            createdAt: new Date(),
            ...(paidAt ? { paidAt } : {}),
          },
        };
      }

      const orderUpsert = await client.query<OrderRow>(
        `INSERT INTO orders (
           order_id, scope, target_key, status, amount_minor,
           currency, provider, checkout_url, meta, created_at, paid_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), $10, NOW())
         ON CONFLICT (order_id) DO UPDATE SET
           scope = CASE WHEN orders.status = 'paid' THEN orders.scope ELSE EXCLUDED.scope END,
           target_key = CASE WHEN orders.status = 'paid' THEN orders.target_key ELSE EXCLUDED.target_key END,
           status = CASE WHEN orders.status = 'paid' THEN 'paid' ELSE EXCLUDED.status END,
           amount_minor = COALESCE(EXCLUDED.amount_minor, orders.amount_minor),
           currency = COALESCE(EXCLUDED.currency, orders.currency),
           provider = COALESCE(EXCLUDED.provider, orders.provider),
           checkout_url = COALESCE(EXCLUDED.checkout_url, orders.checkout_url),
           meta = COALESCE(EXCLUDED.meta, orders.meta),
           paid_at = COALESCE(orders.paid_at, EXCLUDED.paid_at),
           updated_at = NOW()
         RETURNING order_id, scope, target_key, status, amount_minor,
                   currency, provider, checkout_url, meta, created_at, paid_at, updated_at`,
        [
          input.orderId,
          input.scope,
          input.targetKey,
          nextStatus,
          input.amountMinor ?? null,
          input.currency ?? null,
          input.provider ?? null,
          input.checkoutUrl ?? null,
          serializedMeta,
          paidAt,
        ],
      );

      return {
        inserted: true,
        order: mapOrderRow(orderUpsert.rows[0]),
      };
    });
  }

  async markOrderPaidAndGrant(
    input: MarkOrderPaidInput,
  ): Promise<{ inserted: boolean; order: PaymentOrderRecord }> {
    const eventId = input.eventId?.trim() || `order-paid:${input.orderId.trim()}`;
    return this.recordWebhookOrderIfNew({
      ...input,
      eventId,
      status: 'paid',
    });
  }

  async hasPaidEntitlement(scope: EntitlementScope, targetKey: string): Promise<boolean> {
    if (!targetKey || !isEntitlementScope(scope)) {
      return false;
    }

    const scopes = [...matchingScopesFor(scope)];
    const result = await this.pool.query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM orders
       WHERE scope = ANY($1::text[])
         AND target_key = $2
         AND status = 'paid'
       LIMIT 1`,
      [scopes, targetKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getChartInterpretation(
    cacheKey: string,
    topicKey?: string,
  ): Promise<CachedInterpretation | null> {
    if (!cacheKey) return null;

    const resolvedTopic = normalizeTopicKey(topicKey);
    const result = await this.pool.query<ChartInterpretationRow>(
      `SELECT cache_key, topic_key, content, provider, model, created_at
       FROM chart_interpretations
       WHERE cache_key = $1 AND topic_key = $2
       LIMIT 1`,
      [cacheKey, resolvedTopic],
    );
    return result.rows[0] ? mapChartRow(result.rows[0]) : null;
  }

  async saveChartInterpretation(entry: SaveChartInterpretationInput): Promise<void> {
    if (!entry.cacheKey.trim()) {
      throw new Error('cacheKey must be non-empty');
    }
    if (typeof entry.content !== 'string') {
      throw new Error('interpretation content must be a string');
    }

    const resolvedTopic = normalizeTopicKey(entry.topicKey);
    await this.pool.query(
      `INSERT INTO chart_interpretations (
         cache_key, topic_key, content, provider, model, created_at
       )
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (cache_key, topic_key) DO UPDATE SET
         content = EXCLUDED.content,
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         created_at = NOW()`,
      [
        entry.cacheKey,
        resolvedTopic,
        entry.content,
        entry.provider ?? null,
        entry.model ?? null,
      ],
    );
  }

  async getSynastryInterpretation(
    pairKey: string,
    questionHash?: string,
  ): Promise<CachedSynastry | null> {
    if (!pairKey) return null;

    const resolvedHash = normalizeQuestionHash(questionHash);
    const result = await this.pool.query<SynastryInterpretationRow>(
      `SELECT pair_key, question_hash, content, provider, model, created_at
       FROM synastry_interpretations
       WHERE pair_key = $1 AND question_hash = $2
       LIMIT 1`,
      [pairKey, resolvedHash],
    );
    return result.rows[0] ? mapSynastryRow(result.rows[0]) : null;
  }

  async saveSynastryInterpretation(entry: SaveSynastryInterpretationInput): Promise<void> {
    if (!entry.pairKey.trim()) {
      throw new Error('pairKey must be non-empty');
    }
    if (typeof entry.content !== 'string') {
      throw new Error('synastry content must be a string');
    }

    const resolvedHash = normalizeQuestionHash(entry.questionHash);
    await this.pool.query(
      `INSERT INTO synastry_interpretations (
         pair_key, question_hash, content, provider, model, created_at
       )
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (pair_key, question_hash) DO UPDATE SET
         content = EXCLUDED.content,
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         created_at = NOW()`,
      [
        entry.pairKey,
        resolvedHash,
        entry.content,
        entry.provider ?? null,
        entry.model ?? null,
      ],
    );
  }

  async checkHealth(): Promise<{ ok: boolean; mode: 'postgres' | 'memory' }> {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, mode: 'postgres' };
    } catch {
      return { ok: false, mode: 'postgres' };
    }
  }
}

const memoryDb = new InMemoryDbStore();
const memoryAdapter = new MemoryDatabaseAdapter(memoryDb);
let poolSingleton: Pool | null = null;
let poolDatabaseUrl: string | undefined;

export function resetInMemoryDbForTests(): void {
  memoryDb.reset();
}

export function createPool(databaseUrl?: string): Pool {
  const url = (databaseUrl ?? getServerConfig().databaseUrl)?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }
  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', () => {
    // Prevent unhandled idle-client error events from crashing the process.
  });
  return pool;
}

export function getDbPool(): Pool | null {
  const url = getServerConfig().databaseUrl?.trim();
  if (!url) {
    return null;
  }
  if (poolSingleton && poolDatabaseUrl === url) {
    return poolSingleton;
  }
  if (poolSingleton) {
    const stalePool = poolSingleton;
    poolSingleton = null;
    poolDatabaseUrl = undefined;
    void stalePool.end().catch(() => undefined);
  }
  poolSingleton = createPool(url);
  poolDatabaseUrl = url;
  return poolSingleton;
}

export async function closeDbPoolForTests(): Promise<void> {
  if (poolSingleton) {
    const current = poolSingleton;
    poolSingleton = null;
    poolDatabaseUrl = undefined;
    await current.end().catch(() => undefined);
  }
}

export function getDatabaseAdapter(): DatabaseAdapter {
  const pool = getDbPool();
  return pool ? new PostgresDatabaseAdapter(pool) : memoryAdapter;
}

async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function createPendingOrder(
  input: CreatePendingOrderInput,
): Promise<PaymentOrderRecord> {
  return getDatabaseAdapter().createPendingOrder(input);
}

export async function getOrder(orderId: string): Promise<PaymentOrderRecord | null> {
  return getDatabaseAdapter().getOrder(orderId);
}

export async function recordWebhookOrderIfNew(
  input: RecordWebhookOrderInput,
): Promise<{ inserted: boolean; order: PaymentOrderRecord }> {
  return getDatabaseAdapter().recordWebhookOrderIfNew(input);
}

export async function markOrderPaidAndGrant(
  input: MarkOrderPaidInput,
): Promise<{ inserted: boolean; order: PaymentOrderRecord }> {
  return getDatabaseAdapter().markOrderPaidAndGrant(input);
}

export async function hasPaidEntitlement(
  scope: EntitlementScope,
  targetKey: string,
): Promise<boolean> {
  return getDatabaseAdapter().hasPaidEntitlement(scope, targetKey);
}

export async function getChartInterpretation(
  cacheKey: string,
  topicKey?: string,
): Promise<CachedInterpretation | null> {
  return getDatabaseAdapter().getChartInterpretation(cacheKey, topicKey);
}

export async function saveChartInterpretation(
  entry: SaveChartInterpretationInput,
): Promise<void> {
  return getDatabaseAdapter().saveChartInterpretation(entry);
}

export async function getSynastryInterpretation(
  pairKey: string,
  questionHash?: string,
): Promise<CachedSynastry | null> {
  return getDatabaseAdapter().getSynastryInterpretation(pairKey, questionHash);
}

export async function saveSynastryInterpretation(
  entry: SaveSynastryInterpretationInput,
): Promise<void> {
  return getDatabaseAdapter().saveSynastryInterpretation(entry);
}

export async function checkDbHealth(): Promise<{
  ok: boolean;
  mode: 'postgres' | 'memory';
}> {
  return getDatabaseAdapter().checkHealth();
}
