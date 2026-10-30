export type ErrorCode = 'INVALID_MESSAGE' | 'UNSUPPORTED_VERSION' | 'NOT_FOUND' | 'PROJECT_MISMATCH' |
  'VERSION_CONFLICT' | 'STALE_INPUT' | 'IMMUTABLE_SNAPSHOT' | 'INVALID_SELECTION' | 'FILE_MISSING' |
  'HASH_MISMATCH' | 'LIMIT_EXCEEDED' | 'TRANSFER_EXPIRED' | 'TRANSFER_SEQUENCE' | 'BUSY' |
  'CAPABILITY_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' | 'INTERNAL_ERROR' | 'WORKSPACE_INVALID' | 'IDEMPOTENCY_CONFLICT' | 'RUNTIME_UNAVAILABLE';
export class AtelierError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly currentVersion?: number) { super(message); }
}
export function check(value: unknown, message = '입력 형식이 올바르지 않습니다.', code: ErrorCode = 'INVALID_MESSAGE'): asserts value {
  if (!value) throw new AtelierError(code, message);
}
export function safeError(error: unknown) {
  return error instanceof AtelierError
    ? { code: error.code, message: error.message, retryable: ['BUSY', 'STORAGE_UNAVAILABLE'].includes(error.code), ...(error.currentVersion ? { currentVersion: error.currentVersion } : {}) }
    : { code: 'STORAGE_UNAVAILABLE' as const, message: '설계 저장소 작업에 실패했습니다. 기존 데이터를 보존하고 저장 경로와 여유 공간을 확인하세요.', retryable: true };
}
