const tails = new Map<string, Promise<void>>();

export async function withNotificationDeliveryGate<T>(spaceId: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(spaceId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  tails.set(spaceId, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (tails.get(spaceId) === tail) tails.delete(spaceId);
  }
}