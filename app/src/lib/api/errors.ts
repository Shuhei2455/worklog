/**
 * 本家と同じ形のエラー応答。
 *
 * 出典: https://developer.nulab.com/docs/backlog/error-response/
 *
 *   { "errors": [ { "message": "No project.", "code": 6, "moreInfo": "" } ] }
 *
 * 既存スクリプトが `code` で分岐している可能性があるので、
 * 番号の意味も本家に合わせる。
 */

export const ApiErrorCode = {
  InternalError: 1,
  LicenceError: 2,
  LicenceExpiredError: 3,
  AccessDeniedError: 4,
  UnauthorizedOperationError: 5,
  NoResourceError: 6,
  InvalidRequestError: 7,
  SpaceOverCapacityError: 8,
  ResourceOverflowError: 9,
  TooLargeFileError: 10,
  AuthenticationError: 11,
  RequiredMFAError: 12,
} as const;

export type ApiErrorCodeValue =
  (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCodeValue,
    message: string,
    readonly moreInfo = "",
  ) {
    super(message);
  }

  /** 認証されていない */
  static unauthorized(message = "Authentication failure.") {
    return new ApiError(401, ApiErrorCode.AuthenticationError, message);
  }

  /** 権限が無い */
  static denied(message = "You do not have permission.") {
    return new ApiError(403, ApiErrorCode.UnauthorizedOperationError, message);
  }

  /** 見つからない */
  static notFound(what = "resource") {
    return new ApiError(404, ApiErrorCode.NoResourceError, `No ${what}.`);
  }

  /** 引数が不正 */
  static invalid(message: string) {
    return new ApiError(400, ApiErrorCode.InvalidRequestError, message);
  }

  /** レート制限 */
  static tooManyRequests() {
    return new ApiError(
      429,
      ApiErrorCode.InternalError,
      "Too many requests.",
    );
  }
}

export function errorBody(e: ApiError) {
  return {
    errors: [{ message: e.message, code: e.code, moreInfo: e.moreInfo }],
  };
}
