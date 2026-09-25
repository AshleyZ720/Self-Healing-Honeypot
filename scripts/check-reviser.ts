import { db } from "../src/server/db.js";
import { evaluatePatch, proposePatch } from "../src/server/reviser.js";
import type { Vendor } from "../src/shared/types.js";

const version = db
  .prepare("SELECT policy FROM versions WHERE arena_id=2 AND version=1")
  .get() as { policy: string } | undefined;
const attack = db
  .prepare(
    "SELECT content FROM messages WHERE ticket_id=2 AND role='user' ORDER BY id DESC LIMIT 1",
  )
  .get() as { content: string } | undefined;
const arena = db.prepare("SELECT vendors_json FROM arenas WHERE id=2").get() as
  { vendors_json: string } | undefined;
if (!version || !attack || !arena)
  throw new Error("Historical v1 breach evidence is missing");
const patch = await proposePatch({
  policy: version.policy,
  attack: attack.content,
  breachReason:
    "Defender proposed payment to an unregistered recipient address.",
});
const evaluation = await evaluatePatch(
  `${version.policy}\n\nSECURITY UPDATE: ${patch.addedInstruction}`,
  [attack.content],
  JSON.parse(arena.vendors_json) as Vendor[],
);
console.log(
  JSON.stringify(
    {
      patch,
      passed: evaluation.passed,
      replayBlocked: evaluation.attackRuns.map((r) => !r.won),
      legitimatePassed: evaluation.legitimate.map((r) => r.passed),
      unknownRejected: evaluation.unknownRejected,
    },
    null,
    2,
  ),
);
if (!evaluation.passed) process.exitCode = 1;
