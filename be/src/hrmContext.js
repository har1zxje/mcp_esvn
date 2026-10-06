const CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export class HrmContextError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class HrmContextService {
  constructor(_repository = null) {}

  async resolve(userId, requestId = null) {
    if (!CONTEXT_ID.test(String(userId ?? ''))) {
      throw new HrmContextError('HRM_COMPANY_REQUIRED', 'An authenticated HRM context is required.', 401);
    }
    return Object.freeze({
      userId: String(userId),
      ...(requestId ? { requestId: String(requestId) } : {}),
    });
  }
}
