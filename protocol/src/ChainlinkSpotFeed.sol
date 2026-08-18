// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "openzeppelin/access/Ownable2Step.sol";

import {ISpotFeed} from "v2-core/src/interfaces/ISpotFeed.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/**
 * @title ChainlinkSpotFeed
 * @notice ISpotFeed adapter backed directly by a Chainlink AggregatorV3 feed.
 *         Answers are normalized to 18 decimals and rejected when the latest
 *         round is incomplete, non-positive, from the future, or stale.
 */
contract ChainlinkSpotFeed is Ownable2Step, ISpotFeed {
  uint internal constant UNIT = 1e18;

  IAggregatorV3 public immutable aggregator;
  uint8 public immutable decimals;
  uint64 public staleness = 24 hours;

  event StalenessSet(uint64 staleness);

  error CSF_InvalidAggregator();
  error CSF_UnsupportedDecimals();
  error CSF_InvalidRound();
  error CSF_InvalidPrice();
  error CSF_StalePrice();
  error CSF_InvalidStaleness();

  constructor(IAggregatorV3 _aggregator) {
    if (address(_aggregator) == address(0)) revert CSF_InvalidAggregator();
    uint8 aggregatorDecimals = _aggregator.decimals();
    if (aggregatorDecimals > 36) revert CSF_UnsupportedDecimals();
    aggregator = _aggregator;
    decimals = aggregatorDecimals;
  }

  function setStaleness(uint64 _staleness) external onlyOwner {
    if (_staleness == 0) revert CSF_InvalidStaleness();
    staleness = _staleness;
    emit StalenessSet(_staleness);
  }

  function getSpot() external view returns (uint spotPrice, uint confidence) {
    (uint80 roundId, int answer,, uint updatedAt, uint80 answeredInRound) = aggregator.latestRoundData();
    if (roundId == 0 || updatedAt == 0 || updatedAt > block.timestamp || answeredInRound < roundId) {
      revert CSF_InvalidRound();
    }
    if (answer <= 0) revert CSF_InvalidPrice();
    if (block.timestamp - updatedAt > staleness) revert CSF_StalePrice();

    spotPrice = _scaleDecimals(uint(answer));
    if (spotPrice == 0) revert CSF_InvalidPrice();
    confidence = UNIT;
  }

  function _scaleDecimals(uint value) internal view returns (uint) {
    if (decimals <= 18) return value * 10 ** (18 - decimals);
    return value / 10 ** (decimals - 18);
  }
}
