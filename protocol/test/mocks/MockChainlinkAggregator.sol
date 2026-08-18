// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/**
 * @notice Mock Chainlink aggregator proxy with round history and phase support.
 *         Proxy roundIds encode the phase in the top 16 bits: (phaseId << 64) | aggRoundId.
 */
contract MockChainlinkAggregator is IAggregatorV3 {
  struct Round {
    int answer;
    uint updatedAt;
    uint80 answeredInRound;
  }

  uint8 public decimals;
  uint16 public phaseId = 1;
  /// @dev per-phase round counters, so a phase switch restarts aggregator round ids
  mapping(uint16 => uint64) public lastAggRoundId;
  mapping(uint80 => Round) public rounds;

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function setDecimals(uint8 _decimals) external {
    decimals = _decimals;
  }

  /// @notice push a new round in the current phase (also keeps PythSpotFeed test compat)
  function setAnswer(int _answer, uint _updatedAt) external {
    addRound(_answer, _updatedAt);
  }

  /// @notice push a new round in the current phase, returns its proxy roundId
  function addRound(int _answer, uint _updatedAt) public returns (uint80 id) {
    id = _proxyId(phaseId, ++lastAggRoundId[phaseId]);
    rounds[id] = Round(_answer, _updatedAt, id);
  }

  /// @notice overwrite an arbitrary round (e.g. to make one incomplete: answer 0, updatedAt 0)
  function setRound(uint16 _phase, uint64 _aggRoundId, int _answer, uint _updatedAt) external {
    uint80 id = _proxyId(_phase, _aggRoundId);
    rounds[id] = Round(_answer, _updatedAt, id);
    if (_aggRoundId > lastAggRoundId[_phase]) lastAggRoundId[_phase] = _aggRoundId;
  }

  function setAnsweredInRound(uint80 _roundId, uint80 _answeredInRound) external {
    rounds[_roundId].answeredInRound = _answeredInRound;
  }

  /// @notice switch to a new phase (subsequent addRound calls start from aggRoundId 1)
  function setPhase(uint16 _phaseId) external {
    phaseId = _phaseId;
  }

  function latestRoundData() external view returns (uint80, int, uint, uint, uint80) {
    uint80 id = _proxyId(phaseId, lastAggRoundId[phaseId]);
    Round memory r = rounds[id];
    return (id, r.answer, r.updatedAt, r.updatedAt, r.answeredInRound);
  }

  function getRoundData(uint80 _roundId) external view returns (uint80, int, uint, uint, uint80) {
    Round memory r = rounds[_roundId];
    return (_roundId, r.answer, r.updatedAt, r.updatedAt, r.answeredInRound);
  }

  function _proxyId(uint16 _phase, uint64 _aggRoundId) internal pure returns (uint80) {
    return uint80((uint(_phase) << 64) | _aggRoundId);
  }
}
