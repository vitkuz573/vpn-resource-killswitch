type AttemptWindow = {
  count: number;
  firstAt: number;
  blockedUntil?: number;
};

const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 10 * 60 * 1000;

const windows = new Map<string, AttemptWindow>();

function getNow(): number {
  return Date.now();
}

export function canAttempt(identifier: string): { ok: true } | { ok: false; retryInSeconds: number } {
  const now = getNow();
  const current = windows.get(identifier);
  if (!current) {
    return { ok: true };
  }

  if (current.blockedUntil && current.blockedUntil > now) {
    return { ok: false, retryInSeconds: Math.ceil((current.blockedUntil - now) / 1000) };
  }

  if (now - current.firstAt > ATTEMPT_WINDOW_MS) {
    windows.delete(identifier);
    return { ok: true };
  }

  return { ok: true };
}

export function registerFailure(identifier: string): void {
  const now = getNow();
  const current = windows.get(identifier);

  if (!current || now - current.firstAt > ATTEMPT_WINDOW_MS) {
    windows.set(identifier, { count: 1, firstAt: now });
    return;
  }

  current.count += 1;
  if (current.count >= MAX_ATTEMPTS) {
    current.blockedUntil = now + BLOCK_MS;
    current.count = 0;
    current.firstAt = now;
  }
  windows.set(identifier, current);
}

export function registerSuccess(identifier: string): void {
  windows.delete(identifier);
}
