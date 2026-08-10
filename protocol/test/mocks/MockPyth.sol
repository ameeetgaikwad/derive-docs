// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {IPyth} from "../../src/interfaces/IPyth.sol";

contract MockPyth is IPyth {
  mapping(bytes32 => Price) internal prices;
  uint public updateFee = 1 wei;
  uint public lastUpdateValue;
  uint public updateCount;
  PriceFeed internal benchmark;

  function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo, uint publishTime) external {
    prices[id] = Price({price: price, conf: conf, expo: expo, publishTime: publishTime});
  }

  function setUpdateFee(uint fee) external {
    updateFee = fee;
  }

  function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
    return prices[id];
  }

  function getUpdateFee(bytes[] calldata) external view returns (uint) {
    return updateFee;
  }

  function updatePriceFeeds(bytes[] calldata) external payable {
    require(msg.value >= updateFee, "MockPyth: insufficient fee");
    lastUpdateValue = msg.value;
    updateCount++;
  }

  function setBenchmark(bytes32 id, int64 price, uint64 conf, int32 expo, uint publishTime) external {
    Price memory value = Price({price: price, conf: conf, expo: expo, publishTime: publishTime});
    benchmark = PriceFeed({id: id, price: value, emaPrice: value});
  }

  function parsePriceFeedUpdatesUnique(
    bytes[] calldata,
    bytes32[] calldata,
    uint64 minPublishTime,
    uint64 maxPublishTime
  ) external payable returns (PriceFeed[] memory feeds) {
    require(msg.value >= updateFee, "MockPyth: insufficient fee");
    require(benchmark.price.publishTime >= minPublishTime, "MockPyth: too early");
    require(benchmark.price.publishTime <= maxPublishTime, "MockPyth: too late");
    feeds = new PriceFeed[](1);
    feeds[0] = benchmark;
  }
}
