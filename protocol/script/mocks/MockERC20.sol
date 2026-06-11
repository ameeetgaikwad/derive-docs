// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {ERC20} from "openzeppelin/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Test-only ERC20 with open mint, used on anvil (31337) to stand in for
 *         BNB-chain BTCB and USDT (both 18 decimals on BNB). NEVER deploy to a
 *         real network — minting is unrestricted.
 */
contract MockERC20 is ERC20 {
  uint8 internal immutable _tokenDecimals;

  constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
    _tokenDecimals = decimals_;
  }

  function decimals() public view override returns (uint8) {
    return _tokenDecimals;
  }

  /// @dev anyone can mint — anvil only
  function mint(address to, uint amount) external {
    _mint(to, amount);
  }
}
