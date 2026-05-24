import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const standaloneRoot = join(root, ".next", "standalone");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(from, to) {
  if (!(await exists(from))) {
    return;
  }

  await mkdir(join(to, ".."), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}

await copyIfExists(join(root, "public"), join(standaloneRoot, "public"));
await copyIfExists(join(root, ".next", "static"), join(standaloneRoot, ".next", "static"));
await copyIfExists(join(root, "prisma"), join(standaloneRoot, "prisma"));
await copyIfExists(join(root, ".local"), join(standaloneRoot, ".local"));
await copyIfExists(join(root, "dev.db"), join(standaloneRoot, "dev.db"));
await copyIfExists(join(root, "api.txt"), join(standaloneRoot, "api.txt"));
