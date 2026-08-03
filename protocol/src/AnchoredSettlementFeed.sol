// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "openzeppelin/access/Ownable2Step.sol";

import {ISettlementFeed} from "v2-core/src/interfaces/ISettlementFeed.sol";
import {IPyth} from "./interfaces/IPyth.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/**
 * @title AnchoredSettlementFeed
 * @notice ISettlementFeed for the OptionAsset that anchors option settlement prices to
 *         external oracles instead of the protocol's signed feeds. One instance per market
 *         (aggregator + Pyth price id are constructor parameters), analogous to PythSpotFeed
 *         for spot margining.
 *
 *         Why this exists: with LyraForwardFeed as the settlement feed, the price that moves
 *         money at expiry is a 30-min TWAP of *signed* spot data — a compromised 1-of-1 feed
 *         signer can fabricate it. Here the settlement price is fixed permissionlessly from
 *         Chainlink round history, cross-checked against Pyth when fixed near expiry.
 *
 *         How a price gets fixed (once, immutably) for an expiry:
 *
 *         1. `fixSettlementPrice(expiry)` — PERMISSIONLESS. Binary-searches the Chainlink
 *            aggregator's current phase for the first complete round with
 *            `updatedAt >= expiry`, requires it to be at most `maxRoundDelay` after expiry,
 *            scales the answer to 18 decimals, and — if called within `pythCheckWindow` of
 *            expiry and a fresh Pyth price is available — requires the Chainlink answer to
 *            be within `deviationThreshold` of Pyth (reverts otherwise, so a live oracle
 *            disagreement blocks the fix until it resolves or the window passes).
 *
 *         2. Owner override — ESCAPE HATCH ONLY, for when oracle data is unusable (feed
 *            deprecated, expiry predates the aggregator phase, round gap > maxRoundDelay).
 *            `proposeOverride` starts an `overrideDelay` timelock; `executeOverride` applies
 *            it only if the oracle path has still not fixed a price. An oracle fix executed
 *            during the timelock always wins.
 *
 *         Trust model:
 *         - The settlement price is decided by Chainlink round history (with a best-effort
 *           Pyth second opinion near expiry). The protocol's feed signer key CANNOT influence
 *           it.
 *         - The owner can only set a price by publicly proposing it and waiting out the
 *           timelock, during which anyone can produce the oracle-anchored fix and preempt it.
 *           The owner cannot change the aggregator/price id (immutable) and cannot overwrite
 *           an already-fixed price.
 *         - Residual owner powers: parameter setters (bounded below) and — outside this
 *           contract — OptionAsset.setSettlementFeed, which can repoint settlement entirely
 *           and is the reason OptionAsset ownership must be behind a multisig/timelock.
 *
 *         Assumptions on the Chainlink aggregator (hold for production OCR feeds):
 *         - `updatedAt` is non-decreasing in roundId within a phase (binary search relies
 *           on this); incomplete rounds report `updatedAt == 0` and are treated as
 *           before-expiry.
 *         - If the first round of the current phase is already at-or-after expiry, the true
 *           first-at-or-after round may live in an earlier phase that we cannot search —
 *           we revert and leave it to the override path.
 */
contract AnchoredSettlementFeed is Ownable2Step, ISettlementFeed {
  uint internal constant UNIT = 1e18;

  /// @notice Chainlink aggregator (proxy) whose round history anchors the settlement price
  IAggregatorV3 public immutable aggregator;
  /// @notice Pyth price-feeds contract used as a cross-check; address(0) disables the check
  IPyth public immutable pyth;
  /// @notice Pyth price feed id (e.g. Crypto.BTC/USD)
  bytes32 public immutable priceId;

  /// @notice Max delay of the anchor round after expiry; a larger gap needs the override path
  uint64 public maxRoundDelay = 2 hours;
  /// @notice Window after expiry during which a fix is cross-checked against the live Pyth price
  uint64 public pythCheckWindow = 30 minutes;
  /// @notice Max age of the Pyth price for it to participate in the cross-check
  uint64 public pythStaleness = 60;
  /// @notice Max |chainlink - pyth| / chainlink for the cross-check to pass, 18 decimals
  uint public deviationThreshold = 0.01e18;
  /// @notice Timelock between proposing and executing an owner override
  uint64 public overrideDelay = 6 hours;

  /// @notice fixed settlement prices, 18 decimals; 0 == not settled
  mapping(uint64 expiry => uint) public settlementPrices;

  struct OverrideProposal {
    uint192 price;
    uint64 executableAt;
  }

  /// @notice pending owner overrides (escape hatch, timelocked)
  mapping(uint64 expiry => OverrideProposal) public overrideProposals;

  ////////////////////////
  //       Events       //
  ////////////////////////

  event AnchoredSettlementFixed(uint64 indexed expiry, uint80 roundId, uint price, address caller);
  event OverrideProposed(uint64 indexed expiry, uint price, uint64 executableAt);
  event OverrideExecuted(uint64 indexed expiry, uint price);
  event OverrideCancelled(uint64 indexed expiry);
  event MaxRoundDelaySet(uint64 maxRoundDelay);
  event PythCheckWindowSet(uint64 pythCheckWindow);
  event PythStalenessSet(uint64 staleness);
  event DeviationThresholdSet(uint threshold);
  event OverrideDelaySet(uint64 overrideDelay);

  ////////////////////////
  //       Errors       //
  ////////////////////////

  error ASF_AlreadySettled();
  error ASF_AnchorNotYetAvailable();
  error ASF_ExpiryBeforePhaseStart();
  error ASF_IncompleteRound();
  error ASF_AnchorRoundTooLate(uint updatedAt, uint64 expiry, uint64 maxRoundDelay);
  error ASF_PythDisagrees(uint chainlinkPrice, uint pythPrice);
  error ASF_InvalidPrice();
  error ASF_NoOverrideProposal();
  error ASF_OverrideTimelocked(uint64 executableAt, uint timeNow);
  error ASF_InvalidParam();

  ////////////////////////
  //    Constructor     //
  ////////////////////////

  constructor(IAggregatorV3 _aggregator, IPyth _pyth, bytes32 _priceId) {
    require(address(_aggregator) != address(0), "ASF: aggregator is zero");
    require(address(_pyth) == address(0) || _priceId != bytes32(0), "ASF: priceId is zero");
    aggregator = _aggregator;
    pyth = _pyth;
    priceId = _priceId;
  }

  ////////////////////////
  //     Owner-Only     //
  ////////////////////////

  function setMaxRoundDelay(uint64 _maxRoundDelay) external onlyOwner {
    if (_maxRoundDelay == 0) revert ASF_InvalidParam();
    maxRoundDelay = _maxRoundDelay;
    emit MaxRoundDelaySet(_maxRoundDelay);
  }

  /// @param _pythCheckWindow 0 disables the Pyth cross-check entirely
  function setPythCheckWindow(uint64 _pythCheckWindow) external onlyOwner {
    pythCheckWindow = _pythCheckWindow;
    emit PythCheckWindowSet(_pythCheckWindow);
  }

  function setPythStaleness(uint64 _staleness) external onlyOwner {
    if (_staleness == 0) revert ASF_InvalidParam();
    pythStaleness = _staleness;
    emit PythStalenessSet(_staleness);
  }

  /// @param _threshold relative deviation, 18 decimals; must be in (0, 1e18]
  function setDeviationThreshold(uint _threshold) external onlyOwner {
    if (_threshold == 0 || _threshold > UNIT) revert ASF_InvalidParam();
    deviationThreshold = _threshold;
    emit DeviationThresholdSet(_threshold);
  }

  /// @param _overrideDelay must be at least 1 hour — the override is an escape hatch, not a fast path
  function setOverrideDelay(uint64 _overrideDelay) external onlyOwner {
    if (_overrideDelay < 1 hours) revert ASF_InvalidParam();
    overrideDelay = _overrideDelay;
    emit OverrideDelaySet(_overrideDelay);
  }

  /**
   * @notice Propose an owner-set settlement price for `expiry`; executable after `overrideDelay`.
   * @dev Escape hatch for when the oracle path cannot produce a fix. During the timelock anyone
   *      can still call fixSettlementPrice, which takes precedence. Re-proposing resets the clock.
   */
  function proposeOverride(uint64 expiry, uint price) external onlyOwner {
    if (block.timestamp < expiry) revert NotExpired(expiry, block.timestamp);
    if (settlementPrices[expiry] != 0) revert ASF_AlreadySettled();
    if (price == 0 || price > type(uint192).max) revert ASF_InvalidPrice();

    uint64 executableAt = uint64(block.timestamp) + overrideDelay;
    overrideProposals[expiry] = OverrideProposal({price: uint192(price), executableAt: executableAt});
    emit OverrideProposed(expiry, price, executableAt);
  }

  function cancelOverride(uint64 expiry) external onlyOwner {
    if (overrideProposals[expiry].executableAt == 0) revert ASF_NoOverrideProposal();
    delete overrideProposals[expiry];
    emit OverrideCancelled(expiry);
  }

  ////////////////////////
  //  Public Functions  //
  ////////////////////////

  /**
   * @notice PERMISSIONLESS: fix the settlement price for a past expiry from Chainlink round data.
   * @dev Picks the first complete Chainlink round at-or-after `expiry` (binary search over the
   *      aggregator's current phase), bounded by `maxRoundDelay`. If called within
   *      `pythCheckWindow` of expiry and a fresh Pyth price exists, the answer must agree with
   *      Pyth within `deviationThreshold`.
   * @return price the fixed settlement price, 18 decimals
   */
  function fixSettlementPrice(uint64 expiry) external returns (uint price) {
    if (settlementPrices[expiry] != 0) revert ASF_AlreadySettled();
    if (block.timestamp < expiry) revert NotExpired(expiry, block.timestamp);

    (uint80 roundId, uint anchorPrice) = _findAnchorRound(expiry);

    _checkPythAgreement(expiry, anchorPrice);

    settlementPrices[expiry] = anchorPrice;
    emit SettlementPriceSet(expiry, anchorPrice);
    emit AnchoredSettlementFixed(expiry, roundId, anchorPrice, msg.sender);
    return anchorPrice;
  }

  /**
   * @notice Apply a matured owner override. Callable by anyone; a price fixed through the
   *         oracle path in the meantime takes precedence and permanently blocks the override.
   */
  function executeOverride(uint64 expiry) external {
    OverrideProposal memory proposal = overrideProposals[expiry];
    if (proposal.executableAt == 0) revert ASF_NoOverrideProposal();
    if (block.timestamp < proposal.executableAt) {
      revert ASF_OverrideTimelocked(proposal.executableAt, block.timestamp);
    }
    if (settlementPrices[expiry] != 0) revert ASF_AlreadySettled();

    delete overrideProposals[expiry];
    settlementPrices[expiry] = proposal.price;
    emit SettlementPriceSet(expiry, proposal.price);
    emit OverrideExecuted(expiry, proposal.price);
  }

  /// @notice ISettlementFeed — consumed by OptionAsset.calcSettlementValue
  function getSettlementPrice(uint64 expiry) external view returns (bool settled, uint price) {
    price = settlementPrices[expiry];
    settled = price != 0;
  }

  /**
   * @notice View helper: the Chainlink round fixSettlementPrice would anchor to (no Pyth check).
   */
  function findAnchorRound(uint64 expiry) external view returns (uint80 roundId, uint price) {
    return _findAnchorRound(expiry);
  }

  ////////////////////////
  //      Internal      //
  ////////////////////////

  /**
   * @dev Finds the first complete round of the aggregator's current phase with
   *      updatedAt >= expiry and returns its 18-decimal price. Rounds with updatedAt == 0
   *      (incomplete) sort as before-expiry and can never be selected.
   */
  function _findAnchorRound(uint64 expiry) internal view returns (uint80 roundId, uint price) {
    (uint80 latestRoundId, int latestAnswer,, uint latestUpdatedAt,) = aggregator.latestRoundData();
    // Chainlink has not produced a complete round past the expiry yet — try again later
    if (latestUpdatedAt < expiry || latestAnswer <= 0) revert ASF_AnchorNotYetAvailable();

    // proxy roundId = (phaseId << 64) | aggregatorRoundId; search within the current phase
    uint80 phaseBase = latestRoundId - uint80(uint64(latestRoundId));
    uint64 lo = 1;
    uint64 hi = uint64(latestRoundId);

    // if the phase's first round is already at-or-after expiry, the true first round
    // at-or-after expiry may be in a previous phase we cannot reliably search
    (,,, uint firstUpdatedAt,) = aggregator.getRoundData(phaseBase + 1);
    if (firstUpdatedAt != 0 && firstUpdatedAt >= expiry) revert ASF_ExpiryBeforePhaseStart();

    while (lo < hi) {
      uint64 mid = lo + (hi - lo) / 2;
      (,,, uint updatedAt,) = aggregator.getRoundData(phaseBase + mid);
      if (updatedAt >= expiry) {
        hi = mid;
      } else {
        // updatedAt < expiry, or an incomplete round (updatedAt == 0)
        lo = mid + 1;
      }
    }

    roundId = phaseBase + lo;
    (, int answer,, uint anchorUpdatedAt,) = aggregator.getRoundData(roundId);
    // the loop invariant guarantees round (lo - 1) was probed with updatedAt < expiry,
    // so this is the FIRST at-or-after round (given monotonic updatedAt)
    if (answer <= 0 || anchorUpdatedAt < expiry) revert ASF_IncompleteRound();
    if (anchorUpdatedAt > uint(expiry) + maxRoundDelay) {
      revert ASF_AnchorRoundTooLate(anchorUpdatedAt, expiry, maxRoundDelay);
    }

    price = _scaleDecimals(uint(answer), aggregator.decimals());
    if (price == 0) revert ASF_InvalidPrice();
  }

  /**
   * @dev Near expiry (within pythCheckWindow), a fresh Pyth price must agree with the anchor.
   *      Best-effort: if Pyth is unset, has no usable price, or is stale, the check is skipped —
   *      Chainlink alone remains the anchor. Anyone can push a Pyth update (permissionless) to
   *      arm the check before fixing.
   */
  function _checkPythAgreement(uint64 expiry, uint anchorPrice) internal view {
    if (address(pyth) == address(0)) return;
    if (block.timestamp > uint(expiry) + pythCheckWindow) return;

    IPyth.Price memory p = pyth.getPriceUnsafe(priceId);
    if (p.price <= 0) return;
    if (p.publishTime + pythStaleness < block.timestamp) return;

    uint pythPrice = _scaleToUnit(uint(uint64(p.price)), p.expo);
    if (pythPrice == 0) return;

    uint diff = anchorPrice > pythPrice ? anchorPrice - pythPrice : pythPrice - anchorPrice;
    if (diff * UNIT / anchorPrice > deviationThreshold) {
      revert ASF_PythDisagrees(anchorPrice, pythPrice);
    }
  }

  /// @dev scale a `decimals`-decimal value to 18 decimals
  function _scaleDecimals(uint value, uint8 decimals) internal pure returns (uint) {
    if (decimals <= 18) {
      return value * 10 ** (18 - decimals);
    }
    return value / 10 ** (decimals - 18);
  }

  /// @dev scale a Pyth value (base-10 exponent `expo`) to 18 decimals
  function _scaleToUnit(uint value, int32 expo) internal pure returns (uint) {
    int shift = 18 + int(expo);
    if (shift >= 0) {
      return value * 10 ** uint(shift);
    }
    return value / 10 ** uint(-shift);
  }
}
