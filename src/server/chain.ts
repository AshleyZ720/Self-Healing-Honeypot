import {
  createPublicClient,
  createWalletClient,
  defineChain,
  decodeEventLog,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import abiJson from "../shared/HoneypotArena.abi.json";
import { config } from "./config.js";

export const abi = abiJson as Abi;
export const hskTestnet = defineChain({
  id: 133,
  name: "HSK Chain Testnet",
  nativeCurrency: { name: "Test HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: {
    default: { name: "HSK Explorer", url: "https://testnet-explorer.hsk.xyz" },
  },
  testnet: true,
});
export const publicClient = createPublicClient({
  chain: hskTestnet,
  transport: http(config.rpcUrl),
});
export const operator = config.operatorPrivateKey
  ? privateKeyToAccount(config.operatorPrivateKey)
  : undefined;
export const player = config.demoPlayerPrivateKey
  ? privateKeyToAccount(config.demoPlayerPrivateKey)
  : undefined;
export const operatorClient = operator
  ? createWalletClient({
      account: operator,
      chain: hskTestnet,
      transport: http(config.rpcUrl),
    })
  : undefined;
export const playerClient = player
  ? createWalletClient({
      account: player,
      chain: hskTestnet,
      transport: http(config.rpcUrl),
    })
  : undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function waitForChain<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await pause(500);
  }
  throw new Error(
    `HSK RPC did not expose ${label} after confirmation${lastError ? `: ${String(lastError)}` : ""}`,
  );
}

function contract(): `0x${string}` {
  if (!config.contractAddress)
    throw new Error("CONTRACT_ADDRESS is not configured");
  return config.contractAddress;
}

export function policyHash(policy: string): Hex {
  return keccak256(stringToHex(policy));
}
export function contentHash(content: string): Hex {
  return keccak256(stringToHex(content));
}

export async function getChainArena(arenaId: number) {
  const result = (await publicClient.readContract({
    address: contract(),
    abi,
    functionName: "arenas",
    args: [BigInt(arenaId)],
  })) as readonly unknown[];
  return {
    creator: String(result[0]),
    ticketPrice: BigInt(result[1] as bigint).toString(),
    minimumPot: BigInt(result[2] as bigint).toString(),
    version: Number(result[3]),
    stage: ["Funding", "Open", "Patching", "Closed", "Paused"][
      Number(result[4])
    ],
    pot: BigInt(result[5] as bigint).toString(),
    rulesHash: String(result[6]),
    policyHash: String(result[7]),
  };
}

export async function getChainTicket(ticketId: number) {
  const result = (await publicClient.readContract({
    address: contract(),
    abi,
    functionName: "tickets",
    args: [BigInt(ticketId)],
  })) as readonly unknown[];
  return {
    arenaId: Number(result[0]),
    version: Number(result[1]),
    player: String(result[2]),
    expiresAt: Number(result[3]),
    started: Boolean(result[4]),
    settled: Boolean(result[5]),
  };
}

export async function buyDemoTicket(arenaId: number) {
  if (!playerClient || !player)
    throw new Error("Demo player wallet is not configured");
  const arena = await getChainArena(arenaId);
  const tx = await playerClient.writeContract({
    address: contract(),
    abi,
    functionName: "buyTicket",
    args: [BigInt(arenaId)],
    value: BigInt(arena.ticketPrice),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error("Ticket purchase reverted");
  const event = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({ abi, data: log.data, topics: log.topics });
      } catch {
        return undefined;
      }
    })
    .find((log) => log?.eventName === "TicketPurchased");
  if (!event) throw new Error("TicketPurchased event missing");
  const ticketEvent = event.args as unknown as {
    ticketId: bigint;
    version: bigint;
  };
  const ticketId = Number(ticketEvent.ticketId);
  for (let attempt = 0; attempt < 20; attempt++) {
    const visible = await getChainTicket(ticketId);
    if (visible.player.toLowerCase() === player.address.toLowerCase()) break;
    if (attempt === 19)
      throw new Error(
        "HSK RPC has not indexed the new ticket yet; retry starting it shortly",
      );
    await pause(500);
  }
  return {
    ticketId,
    version: Number(ticketEvent.version),
    tx,
    player: player.address,
  };
}

export async function startDemoTicket(ticketId: number) {
  if (!playerClient || !player)
    throw new Error("Demo player wallet is not configured");
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    const visible = await getChainTicket(ticketId);
    if (visible.started) return "already-started";
    if (visible.player.toLowerCase() !== player.address.toLowerCase()) {
      await pause(500);
      continue;
    }
    try {
      const tx = await playerClient.writeContract({
        address: contract(),
        abi,
        functionName: "startTicket",
        args: [BigInt(ticketId)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });
      if (receipt.status !== "success")
        throw new Error("Ticket start reverted");
      await waitForChain(
        () => getChainTicket(ticketId),
        (state) => state.started,
        `ticket ${ticketId} start`,
      );
      return tx;
    } catch (error) {
      lastError = error;
      await pause(500);
    }
  }
  throw lastError || new Error("Could not start ticket on HSK RPC");
}

export async function settleOnChain(input: {
  ticketId: number;
  arenaId: number;
  version: number;
  playerAddress: `0x${string}`;
  transcriptHash: Hex;
  success: boolean;
}) {
  if (!operator || !operatorClient)
    throw new Error("Operator wallet is not configured");
  const nonce =
    BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await operator.signTypedData({
    domain: {
      name: "SelfHealingHoneypot",
      version: "1",
      chainId: config.chainId,
      verifyingContract: contract(),
    },
    types: {
      Verdict: [
        { name: "arenaId", type: "uint256" },
        { name: "version", type: "uint64" },
        { name: "ticketId", type: "uint256" },
        { name: "player", type: "address" },
        { name: "transcriptHash", type: "bytes32" },
        { name: "success", type: "bool" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Verdict",
    message: {
      arenaId: BigInt(input.arenaId),
      version: BigInt(input.version),
      ticketId: BigInt(input.ticketId),
      player: input.playerAddress,
      transcriptHash: input.transcriptHash,
      success: input.success,
      nonce,
      deadline,
    },
  });
  const tx = await operatorClient.writeContract({
    address: contract(),
    abi,
    functionName: "settleVerdict",
    args: [
      BigInt(input.ticketId),
      input.transcriptHash,
      input.success,
      nonce,
      deadline,
      signature,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error("On-chain verdict reverted");
  await waitForChain(
    () => getChainTicket(input.ticketId),
    (state) => state.settled,
    `ticket ${input.ticketId} verdict`,
  );
  if (input.success)
    await waitForChain(
      () => getChainArena(input.arenaId),
      (state) => state.stage === "Patching",
      `arena ${input.arenaId} patching`,
    );
  return { tx, nonce: nonce.toString() };
}

export async function publishVersion(
  arenaId: number,
  newPolicyHash: Hex,
  evidenceHash: Hex,
) {
  if (!operatorClient) throw new Error("Operator wallet is not configured");
  const before = await getChainArena(arenaId);
  const tx = await operatorClient.writeContract({
    address: contract(),
    abi,
    functionName: "publishVersion",
    args: [BigInt(arenaId), newPolicyHash, evidenceHash],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error("Version publication reverted");
  await waitForChain(
    () => getChainArena(arenaId),
    (state) => state.version > before.version,
    `arena ${arenaId} new version`,
  );
  return tx;
}

export async function claimDemoPrize() {
  if (!playerClient || !player)
    throw new Error("Demo player wallet is not configured");
  const tx = await playerClient.writeContract({
    address: contract(),
    abi,
    functionName: "claimPrize",
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error("Prize claim reverted");
  await waitForChain(
    () => getClaimable(),
    (amount) => amount === "0",
    "prize claim",
  );
  return tx;
}

export async function refundDemoTicket(ticketId: number) {
  if (!playerClient) throw new Error("Demo player wallet is not configured");
  const tx = await playerClient.writeContract({
    address: contract(),
    abi,
    functionName: "refundTicket",
    args: [BigInt(ticketId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error("Ticket refund reverted");
  return tx;
}

export async function fundDemoArena(arenaId: number, wei: bigint) {
  if (!operatorClient) throw new Error("Demo sponsor wallet is not configured");
  const before = await getChainArena(arenaId);
  const tx = await operatorClient.writeContract({
    address: contract(),
    abi,
    functionName: "fundArena",
    args: [BigInt(arenaId)],
    value: wei,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error("Arena funding reverted");
  await waitForChain(
    () => getChainArena(arenaId),
    (state) => BigInt(state.pot) >= BigInt(before.pot) + wei,
    `arena ${arenaId} funding`,
  );
  return tx;
}

export async function setArenaPause(arenaId: number, pauseArena: boolean) {
  if (!operatorClient) throw new Error("Operator wallet is not configured");
  const tx = await operatorClient.writeContract({
    address: contract(),
    abi,
    functionName: pauseArena ? "pauseArena" : "resumeArena",
    args: [BigInt(arenaId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error("Arena stage update reverted");
  await waitForChain(
    () => getChainArena(arenaId),
    (state) =>
      pauseArena ? state.stage === "Paused" : state.stage !== "Paused",
    `arena ${arenaId} stage`,
  );
  return tx;
}

export async function cancelUnopenedDemoArena(arenaId: number) {
  if (!operatorClient) throw new Error("Operator wallet is not configured");
  const tx = await operatorClient.writeContract({
    address: contract(),
    abi,
    functionName: "cancelUnopenedArena",
    args: [BigInt(arenaId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error("Unopened arena cancellation reverted");
  await waitForChain(
    () => getChainArena(arenaId),
    (state) => state.stage === "Closed",
    `arena ${arenaId} closure`,
  );
  return tx;
}

export async function claimOperatorRefund() {
  if (!operatorClient || !operator)
    throw new Error("Operator wallet is not configured");
  const tx = await operatorClient.writeContract({
    address: contract(),
    abi,
    functionName: "claimPrize",
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error("Creator refund claim reverted");
  await waitForChain(
    () => getClaimableFor(operator.address),
    (amount) => amount === "0",
    "creator refund",
  );
  return tx;
}

export async function getClaimable() {
  if (!player) return "0";
  return (
    (await publicClient.readContract({
      address: contract(),
      abi,
      functionName: "claimable",
      args: [player.address],
    })) as bigint
  ).toString();
}

export async function getClaimableFor(address: `0x${string}`) {
  return (
    (await publicClient.readContract({
      address: contract(),
      abi,
      functionName: "claimable",
      args: [address],
    })) as bigint
  ).toString();
}
