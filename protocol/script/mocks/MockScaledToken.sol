// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {MockERC20} from "./MockERC20.sol";
import {IScaledUiToken} from "../../src/interfaces/IScaledUiToken.sol";

contract MockScaledToken is MockERC20, IScaledUiToken {
  uint public override uiMultiplier;
  uint public override newUIMultiplier;
  uint public override effectiveAt;

  constructor(string memory name_, string memory symbol_, uint multiplier)
    MockERC20(name_, symbol_, 18)
  {
    uiMultiplier = multiplier;
  }

  function scheduleMultiplier(uint multiplier, uint timestamp) external {
    newUIMultiplier = multiplier;
    effectiveAt = timestamp;
  }

  function applyMultiplier() external {
    require(block.timestamp >= effectiveAt, "not effective");
    uiMultiplier = newUIMultiplier;
    newUIMultiplier = 0;
    effectiveAt = 0;
  }

  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == 0xa60bf13d || interfaceId == 0x4bd27648 || interfaceId == 0x01ffc9a7;
  }
}
