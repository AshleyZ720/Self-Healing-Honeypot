import { formatEther } from "viem";
import { spawnSync } from "node:child_process";
import { config } from "../src/server/config.js";
import { db } from "../src/server/db.js";
import {
  abi,
  getChainArena,
  operator,
  player,
  publicClient,
} from "../src/server/chain.js";

const checks: [string, string][] = [];
const chainId = await publicClient.getChainId();
checks.push(["HSK RPC chain ID", `${chainId}${chainId === 133 ? " ✓" : " ✗"}`]);
checks.push([
  "DeepSeek API key",
  config.deepseekKey ? "configured ✓" : "missing ✗",
]);
checks.push(["Contract address", config.contractAddress || "missing ✗"]);
if (config.contractAddress) {
  const code = await publicClient.getCode({ address: config.contractAddress });
  checks.push([
    "Contract bytecode",
    code && code !== "0x" ? `${(code.length - 2) / 2} bytes ✓` : "missing ✗",
  ]);
}
for (const [role, account] of [
  ["Operator", operator],
  ["Demo player", player],
] as const) {
  const balance = account
    ? await publicClient.getBalance({ address: account.address })
    : 0n;
  checks.push([
    `${role} wallet`,
    account
      ? `${account.address} · ${formatEther(balance)} test HSK ✓`
      : "missing ✗",
  ]);
}
try {
  const result = spawnSync("codex", ["login", "status"], {
    encoding: "utf8",
    timeout: 10000,
  });
  checks.push([
    "Codex CLI",
    result.status === 0 &&
    `${result.stdout}${result.stderr}`.includes("Logged in")
      ? "logged in ✓"
      : "login required ✗",
  ]);
} catch {
  checks.push(["Codex CLI", "unavailable ✗"]);
}
const ids = db
  .prepare("SELECT id, title FROM arenas ORDER BY id DESC")
  .all() as { id: number; title: string }[];
for (const row of ids) {
  const arena = await getChainArena(row.id);
  const policy = db
    .prepare("SELECT policy_hash FROM versions WHERE arena_id=? AND version=?")
    .get(row.id, arena.version) as { policy_hash: string } | undefined;
  checks.push([
    `Arena #${row.id} ${row.title}`,
    `v${arena.version} ${arena.stage} · policy ${policy?.policy_hash.toLowerCase() === arena.policyHash.toLowerCase() ? "matches chain ✓" : "mismatch ✗"}`,
  ]);
  if (arena.version > 1 && config.contractAddress) {
    const stored = db
      .prepare(
        "SELECT evidence_hash FROM versions WHERE arena_id=? AND version=?",
      )
      .get(row.id, arena.version) as { evidence_hash: string } | undefined;
    const onChain = (await publicClient.readContract({
      address: config.contractAddress,
      abi,
      functionName: "patchEvidenceHashes",
      args: [BigInt(row.id)],
    })) as string;
    checks.push([
      `Arena #${row.id} patch evidence`,
      stored?.evidence_hash.toLowerCase() === onChain.toLowerCase()
        ? "matches chain ✓"
        : "mismatch ✗",
    ]);
  }
}
for (const [name, result] of checks)
  console.log(`${name.padEnd(27)} ${result}`);
if (checks.some(([, result]) => result.includes("✗"))) process.exitCode = 1;
