export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function acceptsJson(request: Request): boolean {
  return request.headers.get('content-type')?.toLowerCase().startsWith('application/json') ?? false;
}
