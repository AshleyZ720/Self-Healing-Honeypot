// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/HoneypotArena.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function deal(address who, uint256 newBalance) external;
    function prank(address who) external;
    function warp(uint256 timestamp) external;
}

contract HoneypotArenaTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SIGNER_KEY = 0xA11CE;
    address constant PLAYER = address(0xB0B);
    address constant OTHER = address(0xBAD);
    HoneypotArena arena;

    function setUp() public {
        arena = new HoneypotArena(vm.addr(SIGNER_KEY));
        vm.deal(address(this), 10 ether);
        vm.deal(PLAYER, 1 ether);
        vm.deal(OTHER, 1 ether);
    }

    function _create() internal returns (uint256) {
        return arena.createArena{value: 1 ether}(0.1 ether, 0.05 ether, keccak256("rules"), keccak256("policy"));
    }

    function _ticket(uint256 id) internal returns (uint256 ticketId) {
        vm.prank(PLAYER);
        ticketId = arena.buyTicket{value: 0.1 ether}(id);
        vm.prank(PLAYER);
        arena.startTicket(ticketId);
    }

    function _signature(uint256 arenaId, uint64 version, uint256 ticketId, address player, bytes32 transcript, bool success, uint256 nonce, uint64 deadline) internal returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            arena.VERDICT_TYPEHASH(), arenaId, version, ticketId, player, transcript, success, nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", arena.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function testWinPayoutRolloverAndNextVersion() public {
        uint256 id = _create();
        uint256 ticketId = _ticket(id);
        bytes32 transcript = keccak256("attack transcript");
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _signature(id, 1, ticketId, PLAYER, transcript, true, 42, deadline);
        arena.settleVerdict(ticketId, transcript, true, 42, deadline, sig);
        require(arena.claimable(PLAYER) == 0.756 ether, "70 percent payout");
        (, , , uint64 version, HoneypotArena.Stage stage, uint256 pot, , ) = arena.arenas(id);
        require(version == 1 && stage == HoneypotArena.Stage.Patching, "patching state");
        require(pot == 0.324 ether, "30 percent rollover");
        vm.prank(PLAYER);
        arena.claimPrize();
        require(arena.claimable(PLAYER) == 0, "claim cleared");
        bool duplicateClaimFailed;
        vm.prank(PLAYER);
        try arena.claimPrize() { } catch { duplicateClaimFailed = true; }
        require(duplicateClaimFailed, "duplicate claim rejected");
        arena.publishVersion(id, keccak256("new policy"), keccak256("test evidence"));
        (, , , version, stage, pot, , ) = arena.arenas(id);
        require(version == 2 && stage == HoneypotArena.Stage.Open && pot == 0.324 ether, "next round open");
    }

    function testWrongSignerAndReplayRejected() public {
        uint256 id = _create();
        uint256 ticketId = _ticket(id);
        bytes32 transcript = keccak256("attack transcript");
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory wrongPlayer = _signature(id, 1, ticketId, OTHER, transcript, true, 51, deadline);
        bool failed;
        try arena.settleVerdict(ticketId, transcript, true, 51, deadline, wrongPlayer) { } catch { failed = true; }
        require(failed, "wrong player signature rejected");
        bytes memory sig = _signature(id, 1, ticketId, PLAYER, transcript, true, 51, deadline);
        arena.settleVerdict(ticketId, transcript, true, 51, deadline, sig);
        failed = false;
        try arena.settleVerdict(ticketId, transcript, true, 51, deadline, sig) { } catch { failed = true; }
        require(failed, "replay rejected");
    }

    function testUnusedTicketRefundsAfterExpiry() public {
        uint256 id = _create();
        vm.prank(PLAYER);
        uint256 ticketId = arena.buyTicket{value: 0.1 ether}(id);
        uint256 beforeBalance = PLAYER.balance;
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(PLAYER);
        arena.refundTicket(ticketId);
        require(PLAYER.balance == beforeBalance + 0.1 ether, "full ticket refund");
        (, , , , , bool settled) = arena.tickets(ticketId);
        require(settled, "ticket marked settled");
    }

    function testCreatorCannotDrainActivePot() public {
        uint256 id = _create();
        vm.prank(OTHER);
        arena.fundArena{value: 0.5 ether}(id);
        require(arena.operatorFees() == 0, "no fees from sponsorship");
        bool failed;
        try arena.withdrawFees(payable(OTHER), 0.5 ether) { } catch { failed = true; }
        require(failed, "sponsor funds are not fees");
    }

    function testFirstWinnerClosesRoundAndOtherTicketRefunds() public {
        uint256 id = _create();
        uint256 first = _ticket(id);
        vm.prank(OTHER);
        uint256 second = arena.buyTicket{value: 0.1 ether}(id);
        vm.prank(OTHER);
        arena.startTicket(second);
        bytes32 transcript = keccak256("first wins");
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        arena.settleVerdict(first, transcript, true, 70, deadline, _signature(id, 1, first, PLAYER, transcript, true, 70, deadline));
        uint256 beforeBalance = OTHER.balance;
        vm.prank(OTHER);
        arena.refundTicket(second);
        require(OTHER.balance == beforeBalance + 0.1 ether, "other ticket fully refunded");
        bool failed;
        try arena.settleVerdict(second, transcript, true, 71, deadline, _signature(id, 1, second, OTHER, transcript, true, 71, deadline)) { } catch { failed = true; }
        require(failed, "second winner blocked");
    }

    function testNextVersionWaitsForMinimumFunding() public {
        uint256 id = arena.createArena{value: 1 ether}(0.1 ether, 0.5 ether, keccak256("rules"), keccak256("policy"));
        uint256 ticketId = _ticket(id);
        bytes32 transcript = keccak256("attack");
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        arena.settleVerdict(ticketId, transcript, true, 72, deadline, _signature(id, 1, ticketId, PLAYER, transcript, true, 72, deadline));
        arena.publishVersion(id, keccak256("new policy"), keccak256("evaluation"));
        (, , , , HoneypotArena.Stage stage, uint256 pot, , ) = arena.arenas(id);
        require(stage == HoneypotArena.Stage.Funding && pot == 0.324 ether, "funding gate");
        bool failed;
        vm.prank(PLAYER);
        try arena.buyTicket{value: 0.1 ether}(id) { } catch { failed = true; }
        require(failed, "ticket sales paused under minimum");
        arena.fundArena{value: 0.2 ether}(id);
        (, , , , stage, , , ) = arena.arenas(id);
        require(stage == HoneypotArena.Stage.Open, "sponsorship reopened round");
    }

    function testExpiredAndWrongChainVerdictsFail() public {
        uint256 id = _create();
        uint256 ticketId = _ticket(id);
        bytes32 transcript = keccak256("attack");
        uint64 deadline = uint64(block.timestamp + 10);
        bytes memory signed = _signature(id, 1, ticketId, PLAYER, transcript, true, 73, deadline);
        vm.warp(block.timestamp + 11);
        bool failed;
        try arena.settleVerdict(ticketId, transcript, true, 73, deadline, signed) { } catch { failed = true; }
        require(failed, "expired signature rejected");

        uint64 futureDeadline = uint64(block.timestamp + 10 minutes);
        bytes32 structHash = keccak256(abi.encode(arena.VERDICT_TYPEHASH(), id, uint64(1), ticketId, PLAYER, transcript, true, uint256(74), futureDeadline));
        bytes32 wrongDomain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("SelfHealingHoneypot")), keccak256(bytes("1")), block.chainid + 1, address(arena)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", wrongDomain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        failed = false;
        try arena.settleVerdict(ticketId, transcript, true, 74, futureDeadline, abi.encodePacked(r, s, v)) { } catch { failed = true; }
        require(failed, "wrong chain signature rejected");
    }

    function testFeeConservationAfterLoss() public {
        uint256 id = _create();
        uint256 ticketId = _ticket(id);
        bytes32 transcript = keccak256("safe decision");
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        arena.settleVerdict(ticketId, transcript, false, 75, deadline, _signature(id, 1, ticketId, PLAYER, transcript, false, 75, deadline));
        (, , , , HoneypotArena.Stage stage, uint256 pot, , ) = arena.arenas(id);
        require(stage == HoneypotArena.Stage.Open, "loss leaves arena open");
        require(pot == 1.08 ether && arena.operatorFees() == 0.02 ether, "80/20 ticket split");
        require(address(arena).balance == pot + arena.operatorFees(), "escrow conservation");
    }

    function testPauseAllowsRefundAndResume() public {
        uint256 id = _create();
        vm.prank(PLAYER);
        uint256 ticketId = arena.buyTicket{value: 0.1 ether}(id);
        arena.pauseArena(id);
        (, , , , HoneypotArena.Stage stage, , , ) = arena.arenas(id);
        require(stage == HoneypotArena.Stage.Paused, "paused");
        vm.prank(PLAYER);
        arena.refundTicket(ticketId);
        arena.resumeArena(id);
        (, , , , stage, , , ) = arena.arenas(id);
        require(stage == HoneypotArena.Stage.Open, "resumed");
    }

    function testOnlyNeverOpenedArenaCanClose() public {
        uint256 pending = arena.createArena{value: 0.01 ether}(0.1 ether, 0.05 ether, keccak256("rules"), keccak256("policy"));
        arena.cancelUnopenedArena(pending);
        require(arena.claimable(address(this)) == 0.01 ether, "seed refunded to creator");
        (, , , , HoneypotArena.Stage stage, uint256 pot, , ) = arena.arenas(pending);
        require(stage == HoneypotArena.Stage.Closed && pot == 0, "closed");
        uint256 live = _create();
        bool failed;
        try arena.cancelUnopenedArena(live) { } catch { failed = true; }
        require(failed, "cannot drain live pot");
    }
}
