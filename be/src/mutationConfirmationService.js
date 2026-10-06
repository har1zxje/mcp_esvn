import crypto from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const MUTATION_KIND = /^[a-z][a-z0-9._-]{0,99}$/;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 30 * 60_000;

export class MutationConfirmationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MutationConfirmationError';
    this.code = code;
    this.statusCode = 400;
  }
}

function requiredUuid(value, name) {
  if (!UUID.test(String(value ?? ''))) throw new MutationConfirmationError('CONFIRMATION_CONTEXT_INVALID', `${name} must be a UUID.`);
  return String(value);
}

function requiredContext(executionContext) {
  if (!executionContext || typeof executionContext !== 'object') {
    throw new MutationConfirmationError('CONFIRMATION_CONTEXT_INVALID', 'Authenticated confirmation context is required.');
  }
  const userId = requiredUuid(executionContext.userId, 'userId');
  const conversationId = requiredUuid(executionContext.conversationId, 'conversationId');
  const companyId = String(executionContext.companyId ?? '');
  if (!COMPANY_ID.test(companyId)) throw new MutationConfirmationError('CONFIRMATION_CONTEXT_INVALID', 'companyId is invalid.');
  return { userId, conversationId, companyId };
}

function requiredMutationKind(value) {
  const mutationKind = String(value ?? '');
  if (!MUTATION_KIND.test(mutationKind)) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'mutationKind is invalid.');
  return mutationKind;
}

function isPlainObject(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Payload numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Payload must not contain cycles.');
    seen.add(value);
    const canonical = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return canonical;
  }
  if (!isPlainObject(value)) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Payload must contain JSON values only.');
  if (seen.has(value)) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Payload must not contain cycles.');
  seen.add(value);
  const canonical = {};
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Payload contains a reserved key.');
    }
    canonical[key] = canonicalize(value[key], seen);
  }
  seen.delete(value);
  return canonical;
}

export function canonicalPayload(value) {
  if (!isPlainObject(value)) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Payload must be an object.');
  const canonical = canonicalize(value);
  if (Object.keys(canonical).length === 0) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Payload must not be empty.');
  return canonical;
}

export function payloadDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalPayload(value))).digest('hex');
}

/**
 * A confirmation is accepted only when the human reply contains both an
 * explicit affirmative verb and the opaque confirmation ID. This deliberately
 * has no `confirm=true` or `confirmationId` API for model tool arguments.
 */
export function parseExplicitConfirmation(text) {
  if (typeof text !== 'string') return null;
  const match = /^\s*(?:confirm|xác\s+nhận)\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*[.!]?\s*$/iu.exec(text);
  return match ? match[1].toLowerCase() : null;
}

export class MutationConfirmationService {
  constructor({ confirmationRepository, ttlMs = 5 * 60_000, now = () => new Date() } = {}) {
    if (!confirmationRepository?.create || !confirmationRepository?.consumeBound) {
      throw new TypeError('confirmationRepository with create and consumeBound is required.');
    }
    if (!Number.isInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new TypeError(`ttlMs must be an integer between ${MIN_TTL_MS} and ${MAX_TTL_MS}.`);
    }
    if (typeof now !== 'function') throw new TypeError('now must be a function.');
    this.confirmationRepository = confirmationRepository;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async createPreview({ executionContext, mutationKind, targetIds, resolvedPayload }) {
    const context = requiredContext(executionContext);
    const canonicalTargetIds = canonicalPayload(targetIds);
    const canonicalResolvedPayload = canonicalPayload(resolvedPayload);
    const currentTime = this.now();
    if (!(currentTime instanceof Date) || Number.isNaN(currentTime.getTime())) {
      throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Confirmation clock is invalid.');
    }
    const expiresAt = new Date(currentTime.getTime() + this.ttlMs);
    if (Number.isNaN(expiresAt.getTime())) throw new MutationConfirmationError('CONFIRMATION_INVALID', 'Confirmation clock is invalid.');
    const record = await this.confirmationRepository.create({
      ...context,
      mutationKind: requiredMutationKind(mutationKind),
      targetIds: canonicalTargetIds,
      payloadDigest: payloadDigest(canonicalResolvedPayload),
      resolvedPayload: canonicalResolvedPayload,
      expiresAt,
    });
    // Never return the resolved payload or digest to a caller that only needs
    // a preview prompt. The future domain executor receives it after consume.
    return { confirmationId: record.id, mutationKind: record.mutationKind, targetIds: record.targetIds, expiresAt: record.expiresAt };
  }

  async consumeExplicitConfirmation({ userText, executionContext, mutationKind }) {
    const confirmationId = parseExplicitConfirmation(userText);
    if (!confirmationId) return null;
    const context = requiredContext(executionContext);
    const record = await this.confirmationRepository.consumeBound({
      id: confirmationId,
      ...context,
      mutationKind: requiredMutationKind(mutationKind),
    });
    if (!record) return null;
    // A storage/data-integrity anomaly must fail closed after consumption. The
    // executor gets only payload whose stored digest still matches canonical
    // server-resolved data.
    if (payloadDigest(record.resolvedPayload) !== record.payloadDigest) {
      throw new MutationConfirmationError('CONFIRMATION_INTEGRITY_FAILED', 'The pending confirmation is invalid.');
    }
    return {
      confirmationId: record.id,
      mutationKind: record.mutationKind,
      targetIds: canonicalPayload(record.targetIds),
      resolvedPayload: canonicalPayload(record.resolvedPayload),
      expiresAt: record.expiresAt,
    };
  }
}
