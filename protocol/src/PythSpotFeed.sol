// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "openzeppelin/access/Ownable2Step.sol";

import {ISpotFeed} from "v2-core/src/interfaces/ISpotFeed.sol";
import {IPyth} from "./interfaces/IPyth.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/**
 * @title PythSpotFeed
 * @notice ISpotFeed adapter for the StandardManager: primary price from the on-chain Pyth
 *         contract, cross-checked against a Chainlink aggregator acting as a circuit breaker.
 *
 *         Behaviour of `getSpot()`:
 *           - Pyth price non-positive, or older than `pythStaleness`  -> revert (no usable price,
 *             same failure mode as LyraSpotFeed's stale check);
 *           - confidence = 1e18 - (pythConf / pythPrice), floored at 0 — i.e. Pyth's absolute
 *             confidence interval translated into the protocol's [0, 1e18] confidence score,
 *             which the SRM compares against its oracle-contingency thresholds;
 *           - circuit breaker: if a Chainlink aggregator is configured and its answer is
 *             non-positive, older than `chainlinkStaleness`, or deviates from the Pyth price
 *             by more than `deviationThreshold` (relative to Chainlink), confidence is zeroed,
 *             tripping the SRM's oracle-contingency margin penalty.
 *
 *         All prices are normalised to 18 decimals (Pyth `expo` scaling, Chainlink
 *         `decimals()` scaling — both handled for arbitrary exponents/decimals).
 */
contract PythSpotFeed is Ownable2Step, ISpotFeed {
  uint internal constant UNIT = 1e18;

  /// @notice The Pyth price-feeds contract
  IPyth public immutable pyth;
  /// @notice The Pyth price feed id (e.g. Crypto.BTC/USD)
  bytes32 public immutable priceId;

  /// @notice Chainlink aggregator used as a circuit breaker; address(0) disables the cross-check
  IAggregatorV3 public chainlinkAggregator;
  /// @notice Max age of the Pyth price before getSpot() reverts
  uint64 public pythStaleness = 60;
  /// @notice Max age of the Chainlink answer before the breaker trips (zeroed confidence)
  uint64 public chainlinkStaleness = 24 hours;
  /// @notice Max |pyth - chainlink| / chainlink before the breaker trips, 18 decimals (0.01e18 = 1%)
  uint public deviationThreshold = 0.01e18;

  ////////////////////////
  //       Events       //
  ////////////////////////

  event ChainlinkAggregatorSet(address aggregator);
  event PythStalenessSet(uint64 staleness);
  event ChainlinkStalenessSet(uint64 staleness);
  event DeviationThresholdSet(uint threshold);

  ////////////////////////
  //       Errors       //
  ////////////////////////

  error PSF_InvalidPythPrice();
  error PSF_StalePythPrice();
  error PSF_InvalidStaleness();
  error PSF_InvalidDeviationThreshold();

  ////////////////////////
  //    Constructor     //
  ////////////////////////

  constructor(IPyth _pyth, bytes32 _priceId, IAggregatorV3 _chainlinkAggregator) {
    require(address(_pyth) != address(0), "PSF: pyth is zero");
    require(_priceId != bytes32(0), "PSF: priceId is zero");
    pyth = _pyth;
    priceId = _priceId;
    chainlinkAggregator = _chainlinkAggregator;
  }

  ////////////////////////
  //     Owner-Only     //
  ////////////////////////

  /// @notice Set (or disable with address(0)) the Chainlink circuit-breaker aggregator
  function setChainlinkAggregator(IAggregatorV3 _aggregator) external onlyOwner {
    chainlinkAggregator = _aggregator;
    emit ChainlinkAggregatorSet(address(_aggregator));
  }

  function setPythStaleness(uint64 _staleness) external onlyOwner {
    if (_staleness == 0) revert PSF_InvalidStaleness();
    pythStaleness = _staleness;
    emit PythStalenessSet(_staleness);
  }

  function setChainlinkStaleness(uint64 _staleness) external onlyOwner {
    if (_staleness == 0) revert PSF_InvalidStaleness();
    chainlinkStaleness = _staleness;
    emit ChainlinkStalenessSet(_staleness);
  }

  /// @param _threshold relative deviation, 18 decimals; must be in (0, 1e18]
  function setDeviationThreshold(uint _threshold) external onlyOwner {
    if (_threshold == 0 || _threshold > UNIT) revert PSF_InvalidDeviationThreshold();
    deviationThreshold = _threshold;
    emit DeviationThresholdSet(_threshold);
  }

  ////////////////////////
  //  Public Functions  //
  ////////////////////////

  /**
   * @notice Gets the Pyth spot price (18 decimals) and a [0, 1e18] confidence score
   */
  function getSpot() external view returns (uint spotPrice, uint confidence) {
    IPyth.Price memory p = pyth.getPriceUnsafe(priceId);

    if (p.price <= 0) revert PSF_InvalidPythPrice();
    if (p.publishTime + pythStaleness < block.timestamp) revert PSF_StalePythPrice();

    spotPrice = _scaleToUnit(uint(uint64(p.price)), p.expo);
    if (spotPrice == 0) revert PSF_InvalidPythPrice();

    // translate Pyth's absolute confidence interval into the protocol's confidence score:
    // 1e18 (full confidence) minus the relative width of the interval, floored at 0
    uint relConf = _scaleToUnit(uint(p.conf), p.expo) * UNIT / spotPrice;
    confidence = relConf >= UNIT ? 0 : UNIT - relConf;

    // Chainlink circuit breaker
    if (address(chainlinkAggregator) != address(0) && !_chainlinkAgrees(spotPrice)) {
      confidence = 0;
    }
  }

  ////////////////////////
  //      Internal      //
  ////////////////////////

  /// @dev true iff the Chainlink answer is positive, fresh, and within deviationThreshold of `spotPrice`
  function _chainlinkAgrees(uint spotPrice) internal view returns (bool) {
    (, int answer,, uint updatedAt,) = chainlinkAggregator.latestRoundData();
    if (answer <= 0) return false;
    if (updatedAt + chainlinkStaleness < block.timestamp) return false;

    uint clPrice = _scaleDecimals(uint(answer), chainlinkAggregator.decimals());
    if (clPrice == 0) return false;

    uint diff = spotPrice > clPrice ? spotPrice - clPrice : clPrice - spotPrice;
    return diff * UNIT / clPrice <= deviationThreshold;
  }

  /// @dev scale a Pyth value (base-10 exponent `expo`) to 18 decimals
  function _scaleToUnit(uint value, int32 expo) internal pure returns (uint) {
    // 18 + expo = how many decimal places to add
    int shift = 18 + int(expo);
    if (shift >= 0) {
      return value * 10 ** uint(shift);
    }
    return value / 10 ** uint(-shift);
  }

  /// @dev scale a `decimals`-decimal value to 18 decimals
  function _scaleDecimals(uint value, uint8 decimals) internal pure returns (uint) {
    if (decimals <= 18) {
      return value * 10 ** (18 - decimals);
    }
    return value / 10 ** (decimals - 18);
  }
}
