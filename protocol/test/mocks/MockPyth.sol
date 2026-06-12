// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {IPyth} from "../../src/interfaces/IPyth.sol";

contract MockPyth is IPyth {
  mapping(bytes32 => Price) internal prices;
  uint public updateFee = 1 wei;
  uint public lastUpdateValue;
  uint public updateCount;

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
}
