// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISettlementFeed} from "v2-core/src/interfaces/ISettlementFeed.sol";
import {IPyth} from "./interfaces/IPyth.sol";
import {MultiplierCheckpointRegistry} from "./MultiplierCheckpointRegistry.sol";

/** @notice Permissionless, immutable Pyth benchmark settlement for RWA options. */
contract PythBenchmarkSettlementFeed is ISettlementFeed {
  uint internal constant UNIT = 1e18;

  IPyth public immutable pyth;
  bytes32 public immutable priceId;
  MultiplierCheckpointRegistry public immutable multiplierRegistry;
  uint64 public immutable maxPublishDelay;
  mapping(uint64 => uint) public settlementPrices;

  error PBSF_AlreadySettled();
  error PBSF_InvalidPrice();
  error PBSF_InvalidUpdate();
  error PBSF_InsufficientFee();
  error PBSF_RefundFailed();

  constructor(
    IPyth _pyth,
    bytes32 _priceId,
    MultiplierCheckpointRegistry _multiplierRegistry,
    uint64 _maxPublishDelay
  ) {
    require(address(_pyth) != address(0), "PBSF: pyth is zero");
    require(_priceId != bytes32(0), "PBSF: price id is zero");
    require(_maxPublishDelay > 0, "PBSF: delay is zero");
    pyth = _pyth;
    priceId = _priceId;
    multiplierRegistry = _multiplierRegistry;
    maxPublishDelay = _maxPublishDelay;
  }

  function fixSettlementPrice(uint64 expiry, bytes[] calldata updateData) external payable returns (uint price) {
    if (block.timestamp < expiry) revert NotExpired(expiry, block.timestamp);
    if (settlementPrices[expiry] != 0) revert PBSF_AlreadySettled();

    uint fee = pyth.getUpdateFee(updateData);
    if (msg.value < fee) revert PBSF_InsufficientFee();
    bytes32[] memory ids = new bytes32[](1);
    ids[0] = priceId;
    IPyth.PriceFeed[] memory feeds = pyth.parsePriceFeedUpdatesUnique{value: fee}(
      updateData, ids, expiry, expiry + maxPublishDelay
    );
    if (feeds.length != 1 || feeds[0].id != priceId) revert PBSF_InvalidUpdate();
    IPyth.Price memory p = feeds[0].price;
    if (p.price <= 0 || p.publishTime < expiry || p.publishTime > expiry + maxPublishDelay) {
      revert PBSF_InvalidPrice();
    }

    price = _scaleToUnit(uint(uint64(p.price)), p.expo);
    if (address(multiplierRegistry) != address(0)) {
      price = price * multiplierRegistry.multiplierAt(expiry) / UNIT;
    }
    if (price == 0) revert PBSF_InvalidPrice();
    settlementPrices[expiry] = price;
    emit SettlementPriceSet(expiry, price);

    if (msg.value > fee) {
      (bool ok,) = payable(msg.sender).call{value: msg.value - fee}("");
      if (!ok) revert PBSF_RefundFailed();
    }
  }

  function getSettlementPrice(uint64 expiry) external view returns (bool settled, uint price) {
    if (block.timestamp < expiry) revert NotExpired(expiry, block.timestamp);
    price = settlementPrices[expiry];
    settled = price != 0;
  }

  function _scaleToUnit(uint value, int32 expo) internal pure returns (uint) {
    int shift = 18 + int(expo);
    return shift >= 0 ? value * 10 ** uint(shift) : value / 10 ** uint(-shift);
  }
}
