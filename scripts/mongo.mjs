/**
 * Local MongoDB chalu kare (portable install mate).
 *   npm run mongo
 *
 * MONGO_HOME env var thi path override kari shakay. Default: D:\mongodb
 * Band karva Ctrl+C dabavo.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const home = process.env.MONGO_HOME || "D:\\mongodb";

function findMongod(root) {
  if (!existsSync(root)) return null;
  const direct = join(root, "bin", "mongod.exe");
  if (existsSync(direct)) return direct;
  // ZIP extract karo tyare "mongodb-win32-...-8.0.4" jevu folder bane che.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(root, entry.name, "bin", "mongod.exe");
    if (existsSync(nested)) return nested;
  }
  return null;
}

const mongod = findMongod(home);
if (!mongod) {
  console.error(`mongod.exe "${home}" ma na madyu.`);
  console.error("MongoDB install karo, athva MONGO_HOME env var set karo.");
  process.exit(1);
}

const dbPath = join(home, "data");
const logPath = join(home, "log");
mkdirSync(dbPath, { recursive: true });
mkdirSync(logPath, { recursive: true });

console.log(`Starting: ${mongod}`);
console.log(`  dbPath: ${dbPath}`);
console.log("  Band karva Ctrl+C dabavo.\n");

const child = spawn(
  mongod,
  ["--dbpath", dbPath, "--bind_ip", "127.0.0.1", "--port", "27017"],
  { stdio: "inherit" },
);

const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
