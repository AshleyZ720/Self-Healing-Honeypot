import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/server/config.js";

const url = "http://127.0.0.1:" + config.port + "/api/presenter/story";
const [frozenResponse, freshResponse] = await Promise.all([
  fetch(url),
  fetch(url + "?fresh=1"),
]);
if (!frozenResponse.ok || !freshResponse.ok)
  throw new Error(
    "Presenter API unavailable: " +
      frozenResponse.status +
      " / " +
      freshResponse.status,
  );
const frozen = await frozenResponse.json();
const fresh = await freshResponse.json();
const file = JSON.parse(
  fs.readFileSync(
    path.join(config.root, "evidence/presenter-story.json"),
    "utf8",
  ),
);
assert.deepStrictEqual(frozen, file);
assert.deepStrictEqual(fresh, file);
assert.equal(fresh.source, "recorded");
assert.equal(fresh.chainId, 133);
assert.equal(fresh.chainChecks.transcriptHashMatches, true);
assert.equal(fresh.chainChecks.ticketConfirmed, true);
assert.equal(fresh.chainChecks.claimConfirmed, true);
assert.equal(fresh.chainChecks.v2Confirmed, true);
assert.equal(fresh.gate.attackBlocked, fresh.gate.attackTotal);
assert.equal(fresh.gate.legitimatePassed, fresh.gate.legitimateTotal);
assert.equal(fresh.gate.unknownRejected, true);
console.log(
  "Presenter snapshot matches saved dialogue, HSK receipts, claim, v2 publication and measured release gate.",
);
