import { prisma } from "@/lib/db/prisma";

export async function getCache<T>(namespace: string, key: string) {
  const record = await prisma.apiCache.findUnique({
    where: {
      namespace_key: {
        namespace,
        key,
      },
    },
  });

  if (!record) {
    return null;
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.apiCache.delete({ where: { id: record.id } }).catch(() => undefined);
    return null;
  }

  return JSON.parse(record.value) as T;
}

export async function setCache<T>(
  namespace: string,
  key: string,
  value: T,
  ttlHours: number,
) {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await prisma.apiCache.upsert({
    where: {
      namespace_key: {
        namespace,
        key,
      },
    },
    create: {
      namespace,
      key,
      value: JSON.stringify(value),
      expiresAt,
    },
    update: {
      value: JSON.stringify(value),
      expiresAt,
    },
  });

  return expiresAt;
}

export async function pruneExpiredCache() {
  await prisma.apiCache.deleteMany({
    where: {
      expiresAt: {
        lte: new Date(),
      },
    },
  });
}
