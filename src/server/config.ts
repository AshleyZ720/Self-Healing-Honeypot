import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 8787),
  deepseekKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-flash",
  rpcUrl: process.env.HSK_RPC_URL || "https://testnet.hsk.xyz",
  chainId: Number(process.env.HSK_CHAIN_ID || 133),
  operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY as
    `0x${string}` | undefined,
  demoPlayerPrivateKey: process.env.DEMO_PLAYER_PRIVATE_KEY as
    `0x${string}` | undefined,
  contractAddress: process.env.CONTRACT_ADDRESS as `0x${string}` | undefined,
  contractDeployBlock: process.env.CONTRACT_DEPLOY_BLOCK
    ? BigInt(process.env.CONTRACT_DEPLOY_BLOCK)
    : undefined,
};
