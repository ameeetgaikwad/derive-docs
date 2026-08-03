// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

/**
 * @title IAggregatorV3
 * @notice Minimal Chainlink AggregatorV3Interface — only what the circuit breaker and the
 *         anchored settlement feed need.
 */
interface IAggregatorV3 {
  function decimals() external view returns (uint8);

  function latestRoundData()
    external
    view
    returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

  /// @dev historical round lookup; proxy roundIds encode the phase in the top 16 bits
  function getRoundData(uint80 _roundId)
    external
    view
    returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
