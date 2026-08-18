// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISettlementFeed} from "v2-core/src/interfaces/ISettlementFeed.sol";
import {MultiplierCheckpointRegistry} from "./MultiplierCheckpointRegistry.sol";

/** @notice Converts a per-UI-share settlement price into the raw collateral-token price. */
contract ScaledSettlementFeed is ISettlementFeed {
  uint internal constant UNIT = 1e18;

  ISettlementFeed public immutable uiSettlementFeed;
  MultiplierCheckpointRegistry public immutable multiplierRegistry;

  error SSF_InvalidPrice();

  constructor(ISettlementFeed _uiSettlementFeed, MultiplierCheckpointRegistry _multiplierRegistry) {
    require(address(_uiSettlementFeed) != address(0), "SSF: feed is zero");
    require(address(_multiplierRegistry) != address(0), "SSF: registry is zero");
    uiSettlementFeed = _uiSettlementFeed;
    multiplierRegistry = _multiplierRegistry;
  }

  function getSettlementPrice(uint64 expiry) external view returns (bool settled, uint price) {
    (settled, price) = uiSettlementFeed.getSettlementPrice(expiry);
    if (!settled) return (false, 0);
    price = price * multiplierRegistry.multiplierAt(expiry) / UNIT;
    if (price == 0) revert SSF_InvalidPrice();
  }
}
