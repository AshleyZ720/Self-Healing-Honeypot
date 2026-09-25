import fs from "node:fs";
import path from "node:path";
import { config } from "../src/server/config.js";
import { db } from "../src/server/db.js";
import {
  abi,
  contentHash,
  getChainArena,
  publicClient,
} from "../src/server/chain.js";

const file = path.join(config.root, "evidence/hsk-demo-snapshot.json");
const tables = [
  "arenas",
  "versions",
  "tickets",
  "messages",
  "attempts",
  "events",
  "patch_candidates",
] as const;
type Table = (typeof tables)[number];
type Row = Record<string, string | number | null>;
type Snapshot = {
  chainId: number;
  contract: string;
  exportedAt: string;
  data: Record<Table, Row[]>;
};

if (process.argv[2] === "export") {
  const data = {} as Record<Table, Row[]>;
  data.arenas = db.prepare("SELECT * FROM arenas ORDER BY id").all() as Row[];
  data.versions = db
    .prepare("SELECT * FROM versions ORDER BY arena_id,version")
    .all() as Row[];
  data.tickets = db.prepare("SELECT * FROM tickets ORDER BY id").all() as Row[];
  data.messages = db
    .prepare("SELECT * FROM messages ORDER BY id")
    .all() as Row[];
  data.attempts = db
    .prepare("SELECT * FROM attempts ORDER BY ticket_id")
    .all() as Row[];
  data.events = db.prepare("SELECT * FROM events ORDER BY id").all() as Row[];
  data.patch_candidates = db
    .prepare("SELECT * FROM patch_candidates ORDER BY arena_id,next_version")
    .all() as Row[];
  if (!config.contractAddress) throw new Error("CONTRACT_ADDRESS is missing");
  const snapshot: Snapshot = {
    chainId: 133,
    contract: config.contractAddress,
    exportedAt: new Date().toISOString(),
    data,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Public demo snapshot saved: ${file}`);
  console.log(
    `${data.arenas.length} arenas, ${data.versions.length} versions, ${data.attempts.length} verdicts`,
  );
} else if (process.argv[2] === "restore") {
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  if (
    snapshot.chainId !== 133 ||
    snapshot.contract.toLowerCase() !== config.contractAddress?.toLowerCase()
  )
    throw new Error("Snapshot belongs to another chain or contract");
  const count = (
    db.prepare("SELECT COUNT(*) AS n FROM arenas").get() as { n: number }
  ).n;
  if (count)
    throw new Error(
      "Local database already has arenas; restore only into a fresh database",
    );
  for (const row of snapshot.data.arenas) {
    const chain = await getChainArena(Number(row.id));
    const latest = snapshot.data.versions
      .filter((v) => v.arena_id === row.id)
      .at(-1);
    if (
      !latest ||
      chain.policyHash.toLowerCase() !==
        String(latest.policy_hash).toLowerCase()
    )
      throw new Error(`Arena ${row.id} policy hash does not match chain`);
  }
  for (const attempt of snapshot.data.attempts) {
    const messages = snapshot.data.messages
      .filter((m) => m.ticket_id === attempt.ticket_id)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const transcript = messages.map((m) => ({
      role: m.role,
      content: m.content,
      tools_json: m.tools_json,
    }));
    if (
      contentHash(JSON.stringify(transcript)).toLowerCase() !==
      String(attempt.transcript_hash).toLowerCase()
    )
      throw new Error(`Ticket ${attempt.ticket_id} transcript hash mismatch`);
    const chainHash = (await publicClient.readContract({
      address: config.contractAddress!,
      abi,
      functionName: "verdictHashes",
      args: [BigInt(Number(attempt.ticket_id))],
    })) as string;
    if (
      chainHash.toLowerCase() !== String(attempt.transcript_hash).toLowerCase()
    )
      throw new Error(
        `Ticket ${attempt.ticket_id} verdict hash does not match chain`,
      );
  }
  db.transaction(() => {
    for (const table of tables) {
      for (const row of snapshot.data[table] || []) {
        const columns = Object.keys(row);
        db.prepare(
          `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((c) => row[c]));
      }
    }
  })();
  console.log(
    `Verified and restored ${snapshot.data.arenas.length} arenas from public snapshot.`,
  );
} else {
  throw new Error("Usage: tsx scripts/snapshot.ts export|restore");
}
