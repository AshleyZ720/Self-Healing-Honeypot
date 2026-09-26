import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { LiveArenaStage } from "./experience";

const arena = {
  id: 6,
  title: "Treasury Agent",
  description: "Review vendor invoices.",
  chain: {
    stage: "Open",
    version: 1,
    prizeHsk: "0.00406",
    ticketPriceHsk: "0.001",
  },
  vendors: [
    {
      name: "Northstar Labs",
      address: "0x1111111111111111111111111111111111111111",
      maxAmount: 100,
    },
  ],
};

function props(
  overrides: Partial<ComponentProps<typeof LiveArenaStage>> = {},
): ComponentProps<typeof LiveArenaStage> {
  return {
    arena,
    arenas: [arena],
    ticketData: null,
    claimableHsk: 0,
    ticketId: null,
    pendingWalletSetup: false,
    refundable: false,
    activeTicket: false,
    working: "",
    text: "",
    bossMood: "idle",
    bossLine: "That all you got?",
    onText: () => {},
    onPoke: () => {},
    onSelectArena: () => {},
    onBuy: () => {},
    onStart: () => {},
    onResume: () => {},
    onRefund: () => {},
    onSubmitVerdict: () => {},
    onAttack: () => {},
    onClaim: () => {},
    onNewAttempt: () => {},
    onEvolution: () => {},
    onPresenter: () => {},
    ...overrides,
  };
}

describe("live Arena primary action", () => {
  it("gates a new attack behind a real ticket", () => {
    const html = renderToStaticMarkup(<LiveArenaStage {...props()} />);
    expect(html).toContain("Buy a ticket");
    expect(html).not.toContain("Your invoice attack");
  });

  it("keeps free text editable after a ticket starts", () => {
    const html = renderToStaticMarkup(
      <LiveArenaStage
        {...props({
          ticketId: 11,
          ticketData: { status: "active", message_count: 1 },
          activeTicket: true,
          text: "My own prompt",
        })}
      />,
    );
    expect(html).toContain("Your invoice attack");
    expect(html).toContain("My own prompt");
    expect(html).toContain("Launch attack");
    expect(html).toContain("editable starting points");
  });

  it("offers the on-chain claim after an actual winning verdict", () => {
    const html = renderToStaticMarkup(
      <LiveArenaStage
        {...props({
          ticketId: 11,
          ticketData: {
            status: "settled",
            attempt: {
              won: true,
              reason: "Unregistered recipient proposed.",
              verdict_tx: "0x123",
            },
          },
          claimableHsk: 0.00406,
          bossMood: "defeat",
        })}
      />,
    );
    expect(html).toContain("BOSS DEFEATED");
    expect(html).toContain("Claim 0.0041 test HSK");
  });

  it("does not pretend a cross-computer patch is running locally", () => {
    const html = renderToStaticMarkup(
      <LiveArenaStage
        {...props({
          arena: {
            ...arena,
            chain: { ...arena.chain, stage: "Patching" },
            patchState: { localEvidence: false, ticketId: 8 },
          },
          bossMood: "patch",
        })}
      />,
    );
    expect(html).toContain("Waiting for attack evidence");
    expect(html).toContain("Watch the repair");
  });
});
