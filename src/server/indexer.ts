import { decodeEventLog, type Hex } from "viem";
import { abi, getChainTicket, publicClient } from "./chain.js";
import { config } from "./config.js";
import { db } from "./db.js";

type IndexedEvent = {
  id: number;
  arenaId: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
let running = false;

function plain(value: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}

export async function syncChainEvents(onIndexed: (item: IndexedEvent) => void) {
  if (running || !config.contractAddress) return;
  running = true;
  try {
    const latest = await publicClient.getBlockNumber();
    const saved = db
      .prepare("SELECT value FROM chain_sync WHERE key='next_block'")
      .get() as { value: string } | undefined;
    let nextBlock = saved
      ? BigInt(saved.value)
      : config.contractDeployBlock || (latest > 10000n ? latest - 10000n : 0n);
    for (; nextBlock <= latest; nextBlock += 2000n) {
      const end = nextBlock + 1999n < latest ? nextBlock + 1999n : latest;
      const logs = await publicClient.getLogs({
        address: config.contractAddress,
        fromBlock: nextBlock,
        toBlock: end,
      });
      for (const log of logs) {
        if (!log.transactionHash || log.logIndex === null) continue;
        let decoded;
        try {
          decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        } catch {
          continue;
        }
        const args = plain(decoded.args);
        let arenaId = Number(args.arenaId || 0);
        if (!arenaId && args.ticketId) {
          const ticket = await getChainTicket(Number(args.ticketId));
          arenaId = ticket.arenaId;
        }
        const tx = log.transactionHash as Hex;
        const alreadyRecorded = db
          .prepare(
            "SELECT 1 FROM events WHERE tx_hash=? OR payload_json LIKE ? LIMIT 1",
          )
          .get(tx, `%${tx}%`);
        if (alreadyRecorded) continue;
        const kind = String(decoded.eventName || "unknown_event")
          .replace(/([a-z])([A-Z])/g, "$1_$2")
          .toLowerCase();
        const payload = {
          ...args,
          tx,
          blockNumber: log.blockNumber?.toString(),
          logIndex: log.logIndex,
        };
        const inserted = db
          .prepare(
            "INSERT OR IGNORE INTO events (arena_id, kind, payload_json, tx_hash, log_index) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            arenaId,
            kind,
            JSON.stringify(payload),
            tx,
            Number(log.logIndex),
          );
        if (inserted.changes) {
          if (kind === "ticket_refunded") {
            db.prepare("UPDATE tickets SET status='refunded' WHERE id=?").run(
              Number(args.ticketId),
            );
          } else if (kind === "ticket_started") {
            db.prepare(
              "UPDATE tickets SET status='active' WHERE id=? AND status='ready'",
            ).run(Number(args.ticketId));
          } else if (kind === "verdict_recorded") {
            const ticketId = Number(args.ticketId);
            db.prepare("UPDATE tickets SET status='settled' WHERE id=?").run(
              ticketId,
            );
            db.prepare(
              "UPDATE attempts SET verdict_tx=? WHERE ticket_id=? AND verdict_tx IS NULL",
            ).run(tx, ticketId);
          }
          onIndexed({
            id: Number(inserted.lastInsertRowid),
            arenaId,
            kind,
            payload,
            createdAt: new Date().toISOString(),
          });
        }
      }
      db.prepare(
        "INSERT INTO chain_sync (key,value) VALUES ('next_block',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run((end + 1n).toString());
    }
  } finally {
    running = false;
  }
}
