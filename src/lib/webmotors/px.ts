/** Raised when Webmotors' bot protection (PerimeterX) rejects a request. */
export class PxBlockedError extends Error {
  constructor(readonly openUntil?: number) {
    super('A Webmotors limitou temporariamente as consultas.');
    this.name = 'PxBlockedError';
  }
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/**
 * PerimeterX blocks come back as 403 from a CloudFront Lambda, with a JSON body
 * (`appId`, `uuid`, `blockScript`…) or the "Press & Hold" HTML page. A 429 is
 * treated the same way: back off rather than retry.
 */
export async function isPxBlock(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get('x-cache')?.includes('LambdaGeneratedResponse')) return true;
  try {
    const body = await response.clone().text();
    return /"(appId|blockScript|altBlockScript)"|px-captcha|perimeterx|_pxAppId/i.test(body);
  } catch {
    return true;
  }
}

/** The full-page "Press & Hold" challenge, served in place of a Webmotors page. */
export function isCaptchaPage(doc: Document = document): boolean {
  return !!doc.getElementById('px-captcha') || /access to this page has been denied/i.test(doc.title);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
