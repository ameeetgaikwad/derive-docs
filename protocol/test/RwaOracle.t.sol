// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ISpotFeed} from "v2-core/src/interfaces/ISpotFeed.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {PythSpotFeed} from "../src/PythSpotFeed.sol";
import {ScaledSpotFeed} from "../src/ScaledSpotFeed.sol";
import {MultiplierCheckpointRegistry} from "../src/MultiplierCheckpointRegistry.sol";
import {PythBenchmarkSettlementFeed} from "../src/PythBenchmarkSettlementFeed.sol";
import {MockPyth} from "./mocks/MockPyth.sol";
import {MockScaledToken} from "../script/mocks/MockScaledToken.sol";

contract RwaOracleTest is Test {
  bytes32 internal constant PRICE_ID = keccak256("Equity.US.NVDA/USD");
  MockPyth internal pyth;
  MockScaledToken internal token;
  MultiplierCheckpointRegistry internal registry;

  function setUp() public {
    vm.warp(2_000_000_000);
    pyth = new MockPyth();
    token = new MockScaledToken("Mock NVIDIA", "NVDAB", 0.5e18);
    registry = new MultiplierCheckpointRegistry(token);
  }

  function testScaledSpotUsesLiveMultiplier() public {
    pyth.setPrice(PRICE_ID, 22_000_000_000, 11_000_000, -8, block.timestamp);
    PythSpotFeed uiFeed = new PythSpotFeed(IPyth(address(pyth)), PRICE_ID, IAggregatorV3(address(0)));
    ScaledSpotFeed feed = new ScaledSpotFeed(ISpotFeed(address(uiFeed)), registry);
    (uint price, uint confidence) = feed.getSpot();
    assertEq(price, 110e18);
    assertGt(confidence, 0.99e18);
  }

  function testSettlementUsesMultiplierEffectiveAtExpiry() public {
    uint64 expiry = uint64(block.timestamp + 7 days);
    token.scheduleMultiplier(0.25e18, expiry - 1 days);
    registry.checkpointPending();

    vm.warp(expiry + 10);
    pyth.setBenchmark(PRICE_ID, 24_000_000_000, 0, -8, expiry + 1);
    PythBenchmarkSettlementFeed feed = new PythBenchmarkSettlementFeed(
      IPyth(address(pyth)), PRICE_ID, registry, 5 minutes
    );
    bytes[] memory update = new bytes[](1);
    update[0] = hex"01";
    uint fixedPrice = feed.fixSettlementPrice{value: 1}(expiry, update);
    assertEq(fixedPrice, 60e18);
    (bool settled, uint price) = feed.getSettlementPrice(expiry);
    assertTrue(settled);
    assertEq(price, 60e18);
  }

  function testCurrentCheckpointIsSafeWithScheduledCorporateAction() public {
    token.scheduleMultiplier(0.25e18, block.timestamp + 1 days);
    registry.checkpointPending();
    assertEq(registry.checkpointCurrent(), 0.5e18);
    assertEq(registry.checkpointCount(), 2);
  }

  function testPendingCheckpointCanBeReplacedBeforeItTakesEffect() public {
    uint64 cancelledEffectiveAt = uint64(block.timestamp + 1 days);
    uint64 replacementEffectiveAt = uint64(block.timestamp + 2 days);
    token.scheduleMultiplier(0.25e18, cancelledEffectiveAt);
    registry.checkpointPending();

    token.scheduleMultiplier(0.75e18, replacementEffectiveAt);
    registry.checkpointPending();

    assertEq(registry.checkpointCount(), 2);
    assertEq(registry.multiplierAt(cancelledEffectiveAt), 0.5e18);
    assertEq(registry.multiplierAt(replacementEffectiveAt), 0.75e18);
  }

  function testStalePendingCheckpointFailsClosedUntilReconciled() public {
    uint64 cancelledEffectiveAt = uint64(block.timestamp + 1 days);
    token.scheduleMultiplier(0.25e18, cancelledEffectiveAt);
    registry.checkpointPending();
    token.scheduleMultiplier(0.75e18, block.timestamp + 2 days);

    vm.expectRevert(MultiplierCheckpointRegistry.MCR_StalePendingCheckpoint.selector);
    registry.multiplierAt(cancelledEffectiveAt);

    registry.checkpointCurrent();
    registry.checkpointPending();
    assertEq(registry.multiplierAt(cancelledEffectiveAt), 0.5e18);
  }

  function testAppliedCheckpointRemainsReadableWhenTokenClearsPendingFields() public {
    uint64 effectiveAt = uint64(block.timestamp + 1 days);
    token.scheduleMultiplier(0.25e18, effectiveAt);
    registry.checkpointPending();

    vm.warp(effectiveAt);
    token.applyMultiplier();

    assertEq(registry.multiplierAt(effectiveAt), 0.25e18);
    assertEq(registry.multiplierAt(uint64(block.timestamp)), 0.25e18);
  }

  function testSettlementIsImmutable() public {
    uint64 expiry = uint64(block.timestamp);
    pyth.setBenchmark(PRICE_ID, 24_000_000_000, 0, -8, expiry);
    PythBenchmarkSettlementFeed feed = new PythBenchmarkSettlementFeed(
      IPyth(address(pyth)), PRICE_ID, MultiplierCheckpointRegistry(address(0)), 5 minutes
    );
    bytes[] memory update = new bytes[](1);
    update[0] = hex"01";
    feed.fixSettlementPrice{value: 1}(expiry, update);
    vm.expectRevert(PythBenchmarkSettlementFeed.PBSF_AlreadySettled.selector);
    feed.fixSettlementPrice{value: 1}(expiry, update);
  }
}
