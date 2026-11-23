import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const storeFile = path.join(dataDir, "store.json");

export async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(storeFile, "utf8"));
    return { sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {}, payments: Array.isArray(parsed.payments) ? parsed.payments : [] };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read persistent store; starting empty:", error.message);
    return { sessions: {}, payments: [] };
  }
}

export async function saveStore(store) {
  await mkdir(dataDir, { recursive: true });
  const tmpFile = `${storeFile}.${process.pid}.tmp`;
  await writeFile(tmpFile, JSON.stringify(store), { mode: 0o600 });
  await rename(tmpFile, storeFile);
}
