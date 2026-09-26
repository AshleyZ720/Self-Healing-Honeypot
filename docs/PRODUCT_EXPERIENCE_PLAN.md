# Product experience and presentation mode

This plan follows the team discussion in Slack on 2026-09-26 and Zhenru's UI brief. The supplied concept HTML is a visual reference; its generated IDs, simulated victories, and invented regression counts are not product evidence.

## Goals

1. **A product first impression.** A landing page explains the attack, bounty, HSK role, and self healing loop in seconds. The chick is a small, clickable brand character. Its visual states help tell the story without hiding the onchain controls.
2. **A real Arena.** Keep the existing free text invoice composer, DeepSeek Defender, fixed rule judge, HSK Ticket and escrow, claim, Codex patch and replay, custom challenge builder, and error recovery. Attackers may choose any prompt; preset ideas are optional.
3. **A three minute presentation.** A dedicated Presenter view advances through recorded evidence by click or keyboard. It reads a completed v1→v2 run, displays the original transaction hashes, tool calls, patch, and actual regression counts, and never sends a transaction or runs a model.
4. **Honest provenance.** Every demo frame visibly says “recorded run”. Onchain, local model, and sandbox facts are labeled separately. The simulated invoice payment is never described as a real transfer.
5. **Continuity.** Refreshing the browser restores the last selected Arena and product view. An invalid saved Arena falls back to a current one.

## Presentation sequence

1. The challenge and trusted vendor registry.
2. A v1 Ticket bought on HSK testnet.
3. The attacker controlled invoice and the actual DeepSeek tool call.
4. A deterministic breach decision and the signed onchain verdict.
5. The claim transaction and 70/30 prize rollover.
6. The Codex policy change.
7. The measured release gate: two attack replays blocked, two legitimate invoices passed, one unknown vendor rejected.
8. The v2 policy and evidence hashes published on HSK, followed by the old exploit failing on v2.

The Presenter can jump between frames immediately. It must not use timers to pretend Codex has completed in seconds.

## Verification

- Check the presenter against the saved transcript, onchain receipt, claim transaction, v2 publication and patch evaluation.
- Exercise one live valid payment, one invalid address or amount, and one unknown vendor. Only an actual unauthorized propose_payment call can win.
- Exercise the UI from landing to Arena, through wallet and Ticket gates, as well as refresh persistence.
- Check a narrow and wide viewport. Keep key amounts, version, network, and evidence readable without relying on the mascot.
