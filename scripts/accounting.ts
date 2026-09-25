import { formatEther } from "viem";
import {
  abi,
  getChainArena,
  getChainTicket,
  operator,
  player,
  publicClient,
} from "../src/server/chain.js";
import { config } from "../src/server/config.js";

if (!config.contractAddress) throw new Error("CONTRACT_ADDRESS is missing");
const address = config.contractAddress;
const [arenaCount, ticketCount, fees, contractBalance] = await Promise.all([
  publicClient.readContract({
    address,
    abi,
    functionName: "arenaCount",
  }) as Promise<bigint>,
  publicClient.readContract({
    address,
    abi,
    functionName: "ticketCount",
  }) as Promise<bigint>,
  publicClient.readContract({
    address,
    abi,
    functionName: "operatorFees",
  }) as Promise<bigint>,
  publicClient.getBalance({ address }),
]);
const arenas = await Promise.all(
  Array.from({ length: Number(arenaCount) }, (_, i) => getChainArena(i + 1)),
);
const tickets = await Promise.all(
  Array.from({ length: Number(ticketCount) }, (_, i) => getChainTicket(i + 1)),
);
const activePots = arenas.reduce((sum, arena) => sum + BigInt(arena.pot), 0n);
const pendingTickets = tickets.reduce(
  (sum, ticket) =>
    sum +
    (!ticket.settled &&
    ticket.player !== "0x0000000000000000000000000000000000000000"
      ? BigInt(arenas[ticket.arenaId - 1].ticketPrice)
      : 0n),
  0n,
);
const knownAddresses = [operator?.address, player?.address].filter(
  (a): a is `0x${string}` => Boolean(a),
);
const knownClaims = (
  await Promise.all(
    knownAddresses.map(
      (a) =>
        publicClient.readContract({
          address,
          abi,
          functionName: "claimable",
          args: [a],
        }) as Promise<bigint>,
    ),
  )
).reduce((a, b) => a + b, 0n);
const knownLiabilities = activePots + pendingTickets + fees + knownClaims;
const unexplained = contractBalance - knownLiabilities;
console.log(
  `Contract balance:          ${formatEther(contractBalance)} test HSK`,
);
console.log(`Active arena pots:         ${formatEther(activePots)} test HSK`);
console.log(
  `Unsettled Ticket escrow:   ${formatEther(pendingTickets)} test HSK`,
);
console.log(`Operator fees:             ${formatEther(fees)} test HSK`);
console.log(`Known wallet claimables:   ${formatEther(knownClaims)} test HSK`);
console.log(`Other liabilities/residue: ${formatEther(unexplained)} test HSK`);
if (unexplained < 0n)
  throw new Error("Contract balance is below known liabilities");
