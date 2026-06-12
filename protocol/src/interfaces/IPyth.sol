// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

/**
 * @title IPyth
 * @notice Minimal interface to the Pyth price-feeds contract — only the functions the
 *         hedge protocol consumes. ABI-compatible with pyth-sdk-solidity's IPyth /
 *         PythStructs (the struct encodes as the same tuple).
 */
interface IPyth {
  /// @dev mirrors PythStructs.Price
  struct Price {
    // price value (scaled by 10^expo)
    int64 price;
    // confidence interval around the price (same scaling)
    uint64 conf;
    // price exponent (typically negative, e.g. -8)
    int32 expo;
    // unix timestamp of when this price was published
    uint publishTime;
  }

  /// @notice Returns the price of a feed without any sanity checks (caller checks staleness)
  function getPriceUnsafe(bytes32 id) external view returns (Price memory price);

  /// @notice Required fee (in wei) to submit `updateData`
  function getUpdateFee(bytes[] calldata updateData) external view returns (uint feeAmount);

  /// @notice Updates price feeds with signed data from Hermes; requires `getUpdateFee` as msg.value
  function updatePriceFeeds(bytes[] calldata updateData) external payable;
}
