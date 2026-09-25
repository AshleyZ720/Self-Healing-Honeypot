import fs from "node:fs";
import path from "node:path";
import { config } from "../src/server/config.js";
import {
  hskTestnet,
  operator,
  operatorClient,
  publicClient,
} from "../src/server/chain.js";
import { type Abi } from "viem";

if (!operator || !operatorClient)
  throw new Error("OPERATOR_PRIVATE_KEY is missing in .env.local");
if (config.contractAddress) {
  console.log(`Contract already configured: ${config.contractAddress}`);
  process.exit(0);
}
const artifactPath = path.join(
  config.root,
  "contracts/out/HoneypotArena.sol/HoneypotArena.json",
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
  abi: Abi;
  bytecode: { object: `0x${string}` };
};
const tx = await operatorClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [operator.address],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error("Deployment failed");
fs.appendFileSync(
  path.join(config.root, ".env.local"),
  `CONTRACT_ADDRESS=${receipt.contractAddress}\n`,
);
console.log(`HSK Chain ${hskTestnet.id} contract: ${receipt.contractAddress}`);
console.log(`Transaction: ${hskTestnet.blockExplorers.default.url}/tx/${tx}`);
