// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISpotFeed} from "v2-core/src/interfaces/ISpotFeed.sol";
import {MultiplierCheckpointRegistry} from "./MultiplierCheckpointRegistry.sol";

/** @notice Converts a per-UI-share oracle price into the price of one raw bStock token. */
contract ScaledSpotFeed is ISpotFeed {
  uint internal constant UNIT = 1e18;
  ISpotFeed public immutable uiSpotFeed;
  MultiplierCheckpointRegistry public immutable multiplierRegistry;

  constructor(ISpotFeed _uiSpotFeed, MultiplierCheckpointRegistry _multiplierRegistry) {
    require(address(_uiSpotFeed) != address(0), "SSF: feed is zero");
    require(address(_multiplierRegistry) != address(0), "SSF: registry is zero");
    uiSpotFeed = _uiSpotFeed;
    multiplierRegistry = _multiplierRegistry;
  }

  function getSpot() external view returns (uint spotPrice, uint confidence) {
    (uint uiPrice, uint feedConfidence) = uiSpotFeed.getSpot();
    spotPrice = uiPrice * multiplierRegistry.currentMultiplier() / UNIT;
    confidence = feedConfidence;
  }
}
