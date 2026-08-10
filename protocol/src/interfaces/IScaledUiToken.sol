// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

/** @notice BEP-8056 scaled UI amount surface used by bStocks. */
interface IScaledUiToken {
  function uiMultiplier() external view returns (uint);
  function newUIMultiplier() external view returns (uint);
  function effectiveAt() external view returns (uint);
}
