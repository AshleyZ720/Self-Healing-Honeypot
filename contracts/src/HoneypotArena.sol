// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice HSK testnet escrow for a versioned prompt-injection challenge.
/// @dev The operator attests model outcomes. This contract does not verify inference.
contract HoneypotArena {
    enum Stage { Funding, Open, Patching, Closed, Paused }

    struct Arena {
        address creator;
        uint96 ticketPrice;
        uint96 minimumPot;
        uint64 version;
        Stage stage;
        uint256 pot;
        bytes32 rulesHash;
        bytes32 policyHash;
    }

    struct Ticket {
        uint256 arenaId;
        uint64 version;
        address player;
        uint64 expiresAt;
        bool started;
        bool settled;
    }

    bytes32 public constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 arenaId,uint64 version,uint256 ticketId,address player,bytes32 transcriptHash,bool success,uint256 nonce,uint64 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    uint256 public constant TICKET_POT_BPS = 8000;
    uint256 public constant WINNER_BPS = 7000;
    uint256 public constant BPS = 10000;
    uint64 public constant TICKET_LIFETIME = 1 hours;

    address public immutable operator;
    address public verdictSigner;
    uint256 public arenaCount;
    uint256 public ticketCount;
    uint256 public operatorFees;
    mapping(uint256 => Arena) public arenas;
    mapping(uint256 => Ticket) public tickets;
    mapping(uint256 => bytes32) public verdictHashes;
    mapping(uint256 => bytes32) public patchEvidenceHashes;
    mapping(address => uint256) public claimable;
    mapping(uint256 => bool) public usedNonces;
    bool private entered;

    event ArenaCreated(uint256 indexed arenaId, address indexed creator, uint256 seed, bytes32 rulesHash, bytes32 policyHash);
    event ArenaFunded(uint256 indexed arenaId, address indexed sponsor, uint256 amount, uint256 pot);
    event TicketPurchased(uint256 indexed ticketId, uint256 indexed arenaId, uint64 version, address indexed player, uint64 expiresAt);
    event TicketStarted(uint256 indexed ticketId);
    event TicketRefunded(uint256 indexed ticketId, address indexed player, uint256 amount);
    event VerdictRecorded(uint256 indexed ticketId, uint256 indexed arenaId, uint64 version, bool success, bytes32 transcriptHash, uint256 prize);
    event VersionPublished(uint256 indexed arenaId, uint64 version, bytes32 policyHash, bytes32 evidenceHash, Stage stage);
    event PrizeClaimed(address indexed player, uint256 amount);
    event ArenaPaused(uint256 indexed arenaId);
    event ArenaResumed(uint256 indexed arenaId, Stage stage);
    event UnopenedArenaCancelled(uint256 indexed arenaId, uint256 refundedSeed);

    error Unauthorized();
    error InvalidState();
    error InvalidAmount();
    error InvalidTicket();
    error InvalidSignature();
    error TransferFailed();

    modifier nonReentrant() {
        if (entered) revert InvalidState();
        entered = true;
        _;
        entered = false;
    }

    constructor(address signer) {
        if (signer == address(0)) revert InvalidSignature();
        operator = msg.sender;
        verdictSigner = signer;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("SelfHealingHoneypot")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function createArena(
        uint96 ticketPrice,
        uint96 minimumPot,
        bytes32 rulesHash,
        bytes32 policyHash
    ) external payable returns (uint256 arenaId) {
        if (ticketPrice == 0 || minimumPot == 0 || rulesHash == bytes32(0) || policyHash == bytes32(0)) revert InvalidAmount();
        arenaId = ++arenaCount;
        Arena storage a = arenas[arenaId];
        a.creator = msg.sender;
        a.ticketPrice = ticketPrice;
        a.minimumPot = minimumPot;
        a.version = 1;
        a.stage = msg.value >= minimumPot ? Stage.Open : Stage.Funding;
        a.pot = msg.value;
        a.rulesHash = rulesHash;
        a.policyHash = policyHash;
        emit ArenaCreated(arenaId, msg.sender, msg.value, rulesHash, policyHash);
    }

    function fundArena(uint256 arenaId) external payable {
        Arena storage a = arenas[arenaId];
        if (a.creator == address(0) || a.stage == Stage.Closed || msg.value == 0) revert InvalidState();
        a.pot += msg.value;
        if (a.stage == Stage.Funding && a.pot >= a.minimumPot) a.stage = Stage.Open;
        emit ArenaFunded(arenaId, msg.sender, msg.value, a.pot);
    }

    /// @notice Emergency stop. Outstanding tickets become refundable while paused.
    function pauseArena(uint256 arenaId) external {
        if (msg.sender != operator) revert Unauthorized();
        Arena storage a = arenas[arenaId];
        if (a.stage != Stage.Open) revert InvalidState();
        a.stage = Stage.Paused;
        emit ArenaPaused(arenaId);
    }

    function resumeArena(uint256 arenaId) external {
        if (msg.sender != operator) revert Unauthorized();
        Arena storage a = arenas[arenaId];
        if (a.stage != Stage.Paused) revert InvalidState();
        a.stage = a.pot >= a.minimumPot ? Stage.Open : Stage.Funding;
        emit ArenaResumed(arenaId, a.stage);
    }

    /// @notice Only an arena that never opened can be cancelled and its seed recovered.
    function cancelUnopenedArena(uint256 arenaId) external {
        Arena storage a = arenas[arenaId];
        if (msg.sender != a.creator) revert Unauthorized();
        if (a.version != 1 || a.stage != Stage.Funding) revert InvalidState();
        uint256 seed = a.pot;
        a.pot = 0;
        a.stage = Stage.Closed;
        claimable[msg.sender] += seed;
        emit UnopenedArenaCancelled(arenaId, seed);
    }

    function buyTicket(uint256 arenaId) external payable returns (uint256 ticketId) {
        Arena storage a = arenas[arenaId];
        if (a.stage != Stage.Open || a.creator == address(0)) revert InvalidState();
        if (msg.value != a.ticketPrice) revert InvalidAmount();
        ticketId = ++ticketCount;
        uint64 expiry = uint64(block.timestamp) + TICKET_LIFETIME;
        tickets[ticketId] = Ticket(arenaId, a.version, msg.sender, expiry, false, false);
        emit TicketPurchased(ticketId, arenaId, a.version, msg.sender, expiry);
    }

    function startTicket(uint256 ticketId) external {
        Ticket storage t = tickets[ticketId];
        Arena storage a = arenas[t.arenaId];
        if (t.player != msg.sender) revert Unauthorized();
        if (t.settled || t.started || block.timestamp > t.expiresAt || a.version != t.version || a.stage != Stage.Open) revert InvalidTicket();
        t.started = true;
        emit TicketStarted(ticketId);
    }

    function settleVerdict(
        uint256 ticketId,
        bytes32 transcriptHash,
        bool success,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        Ticket storage t = tickets[ticketId];
        Arena storage a = arenas[t.arenaId];
        if (!t.started || t.settled || a.version != t.version || a.stage != Stage.Open) revert InvalidTicket();
        if (transcriptHash == bytes32(0) || block.timestamp > t.expiresAt || block.timestamp > deadline || usedNonces[nonce]) revert InvalidTicket();
        bytes32 structHash = keccak256(abi.encode(
            VERDICT_TYPEHASH, t.arenaId, t.version, ticketId, t.player, transcriptHash, success, nonce, deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        if (_recover(digest, signature) != verdictSigner) revert InvalidSignature();
        usedNonces[nonce] = true;
        t.settled = true;
        verdictHashes[ticketId] = transcriptHash;
        uint256 ticketPrice = a.ticketPrice;
        a.pot += ticketPrice * TICKET_POT_BPS / BPS;
        operatorFees += ticketPrice - ticketPrice * TICKET_POT_BPS / BPS;
        uint256 prize;
        if (success) {
            prize = a.pot * WINNER_BPS / BPS;
            a.pot -= prize;
            claimable[t.player] += prize;
            a.stage = Stage.Patching;
        }
        emit VerdictRecorded(ticketId, t.arenaId, t.version, success, transcriptHash, prize);
    }

    function refundTicket(uint256 ticketId) external nonReentrant {
        Ticket storage t = tickets[ticketId];
        Arena storage a = arenas[t.arenaId];
        if (t.player != msg.sender) revert Unauthorized();
        if (t.settled || (block.timestamp <= t.expiresAt && a.version == t.version && a.stage == Stage.Open)) revert InvalidTicket();
        t.settled = true;
        uint256 amount = a.ticketPrice;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TicketRefunded(ticketId, msg.sender, amount);
    }

    function publishVersion(uint256 arenaId, bytes32 newPolicyHash, bytes32 evidenceHash) external {
        if (msg.sender != operator) revert Unauthorized();
        Arena storage a = arenas[arenaId];
        if (a.stage != Stage.Patching || newPolicyHash == bytes32(0) || evidenceHash == bytes32(0)) revert InvalidState();
        a.version += 1;
        a.policyHash = newPolicyHash;
        a.stage = a.pot >= a.minimumPot ? Stage.Open : Stage.Funding;
        patchEvidenceHashes[arenaId] = evidenceHash;
        emit VersionPublished(arenaId, a.version, newPolicyHash, evidenceHash, a.stage);
    }

    function claimPrize() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert InvalidAmount();
        claimable[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PrizeClaimed(msg.sender, amount);
    }

    function withdrawFees(address payable to, uint256 amount) external nonReentrant {
        if (msg.sender != operator) revert Unauthorized();
        if (amount > operatorFees || to == address(0)) revert InvalidAmount();
        operatorFees -= amount;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function setVerdictSigner(address signer) external {
        if (msg.sender != operator) revert Unauthorized();
        if (signer == address(0)) revert InvalidSignature();
        verdictSigner = signer;
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 || (v != 27 && v != 28)) revert InvalidSignature();
        return ecrecover(digest, v, r, s);
    }

    receive() external payable { revert InvalidAmount(); }
}
