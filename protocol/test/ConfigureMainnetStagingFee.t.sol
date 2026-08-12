// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {ConfigureMainnetStagingFee} from "../script/ConfigureMainnetStagingFee.s.sol";

contract ConfigureMainnetStagingFeeHarness is ConfigureMainnetStagingFee {
  function validateChain(uint256 chainId) external pure {
    _validateChain(chainId);
  }

  function validateConfirmation(string memory confirmation) external pure {
    _validateConfirmation(confirmation);
  }

  function validateDeployment(
    uint256 chainId,
    address manager,
    address deploymentOwner,
    address broadcaster
  ) external pure {
    _validateDeployment(chainId, manager, deploymentOwner, broadcaster);
  }
}

contract ConfigureMainnetStagingFeeTest is Test {
  ConfigureMainnetStagingFeeHarness internal script;

  function setUp() public {
    script = new ConfigureMainnetStagingFeeHarness();
  }

  function testUsesMicroSmokeMinimumWithoutChangingPercentageRate() public {
    assertEq(script.EXPECTED_CURRENT_MIN_OI_FEE(), 10e18);
    assertEq(script.STAGING_SMOKE_MIN_OI_FEE(), 0.01e18);
  }

  function testRejectsWrongChain() public {
    vm.expectRevert(
      abi.encodeWithSelector(ConfigureMainnetStagingFee.WrongChain.selector, 56, 97)
    );
    script.validateChain(97);
  }

  function testRejectsWrongConfirmation() public {
    vm.expectRevert(ConfigureMainnetStagingFee.InvalidConfirmation.selector);
    script.validateConfirmation("wrong");
  }

  function testAcceptsReviewedStagingTarget() public view {
    script.validateDeployment(
      56,
      script.STAGING_STANDARD_MANAGER(),
      script.STAGING_OWNER(),
      script.STAGING_OWNER()
    );
  }

  function testRejectsDifferentManager() public {
    address owner = script.STAGING_OWNER();
    vm.expectRevert(
      abi.encodeWithSelector(
        ConfigureMainnetStagingFee.DeploymentManagerMismatch.selector,
        address(0x1234)
      )
    );
    script.validateDeployment(56, address(0x1234), owner, owner);
  }

  function testRejectsDifferentBroadcaster() public {
    address manager = script.STAGING_STANDARD_MANAGER();
    address owner = script.STAGING_OWNER();
    vm.expectRevert(
      abi.encodeWithSelector(
        ConfigureMainnetStagingFee.BroadcasterMismatch.selector,
        address(0x1234)
      )
    );
    script.validateDeployment(
      56,
      manager,
      owner,
      address(0x1234)
    );
  }
}
