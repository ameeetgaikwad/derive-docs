// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

contract MockChainlinkAggregator is IAggregatorV3 {
  uint8 public decimals;
  int public answer;
  uint public updatedAt;
  uint80 public roundId = 1;

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function setDecimals(uint8 _decimals) external {
    decimals = _decimals;
  }

  function setAnswer(int _answer, uint _updatedAt) external {
    answer = _answer;
    updatedAt = _updatedAt;
    roundId++;
  }

  function latestRoundData() external view returns (uint80, int, uint, uint, uint80) {
    return (roundId, answer, updatedAt, updatedAt, roundId);
  }
}
