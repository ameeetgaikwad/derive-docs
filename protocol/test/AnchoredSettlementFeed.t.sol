// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {AnchoredSettlementFeed} from "../src/AnchoredSettlementFeed.sol";
import {ISettlementFeed} from "v2-core/src/interfaces/ISettlementFeed.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {MockPyth} from "./mocks/MockPyth.sol";
import {MockChainlinkAggregator} from "./mocks/MockChainlinkAggregator.sol";

contract AnchoredSettlementFeedTest is Test {
  // local mirrors for vm.expectEmit (0.8.20 cannot emit foreign events)
  event SettlementPriceSet(uint indexed expiry, uint settlementPrice);
  event AnchoredSettlementFixed(uint64 indexed expiry, uint80 roundId, uint price, address caller);

  bytes32 internal constant BTC_PRICE_ID = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
  uint64 internal constant EXPIRY = 1_781_856_000; // 2026-06-19 08:00 UTC

  MockPyth internal pyth;
  MockChainlinkAggregator internal chainlink; // 8 decimals, like the real BTC/USD aggregator
  AnchoredSettlementFeed internal feed;

  function setUp() public {
    pyth = new MockPyth();
    chainlink = new MockChainlinkAggregator(8);
    feed = new AnchoredSettlementFeed(
      IAggregatorV3(address(chainlink)), IPyth(address(pyth)), BTC_PRICE_ID
    );

    // round history straddling the expiry (8 decimals):
    //   1: 61,900 two hours before expiry
    //   2: 62,000 one hour before expiry
    //   3: 62,300 five minutes AFTER expiry  <- the anchor round
    //   4: 62,500 one hour after expiry
    chainlink.addRound(6_190_000_000_000, EXPIRY - 2 hours);
    chainlink.addRound(6_200_000_000_000, EXPIRY - 1 hours);
    chainlink.addRound(6_230_000_000_000, EXPIRY + 5 minutes);
    chainlink.addRound(6_250_000_000_000, EXPIRY + 1 hours);

    // fix "late" by default: well past the pyth check window, pyth data irrelevant/stale
    vm.warp(EXPIRY + 2 days);
  }

  // ------------------------------------------------------------ round selection

  function testPicksFirstRoundAtOrAfterExpiry() public {
    uint price = feed.fixSettlementPrice(EXPIRY);
    assertEq(price, 62_300e18); // round 3, not round 2 (before) nor round 4 (later)

    (bool settled, uint stored) = feed.getSettlementPrice(EXPIRY);
    assertTrue(settled);
    assertEq(stored, 62_300e18);
  }

  function testPicksRoundExactlyAtExpiry() public {
    // insert a round exactly at the expiry timestamp between rounds 2 and 3
    chainlink.setRound(1, 3, 6_222_200_000_000, EXPIRY);
    chainlink.setRound(1, 4, 6_230_000_000_000, EXPIRY + 5 minutes);
    chainlink.setRound(1, 5, 6_250_000_000_000, EXPIRY + 1 hours);
    assertEq(feed.fixSettlementPrice(EXPIRY), 62_222e18);
  }

  function testPicksLatestRoundWhenItIsTheAnchor() public {
    // only rounds 1..3 exist, round 3 is both the latest and the anchor
    chainlink.setRound(1, 4, 0, 0);
    // rebuild: cheaper to use a fresh mock
    MockChainlinkAggregator cl = new MockChainlinkAggregator(8);
    cl.addRound(6_190_000_000_000, EXPIRY - 2 hours);
    cl.addRound(6_200_000_000_000, EXPIRY - 1 hours);
    cl.addRound(6_230_000_000_000, EXPIRY + 5 minutes);
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(pyth)), BTC_PRICE_ID);
    assertEq(f.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  function testLongHistoryBinarySearch() public {
    MockChainlinkAggregator cl = new MockChainlinkAggregator(8);
    // 500 rounds every 10 minutes; expiry falls between two of them
    uint start = EXPIRY - 400 * 10 minutes + 3 minutes;
    uint80 expectedRound;
    uint expectedAnswer;
    for (uint i = 0; i < 500; i++) {
      int answer = int(6_000_000_000_000 + i * 1_000_000_000);
      uint updatedAt = start + i * 10 minutes;
      uint80 id = cl.addRound(answer, updatedAt);
      if (expectedRound == 0 && updatedAt >= EXPIRY) {
        expectedRound = id;
        expectedAnswer = uint(answer);
      }
    }
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(0)), bytes32(0));
    (uint80 roundId, uint price) = f.findAnchorRound(EXPIRY);
    assertEq(roundId, expectedRound);
    assertEq(price, expectedAnswer * 1e10);
    assertEq(f.fixSettlementPrice(EXPIRY), expectedAnswer * 1e10);
  }

  function testWorksInLaterPhase() public {
    chainlink.setPhase(7);
    chainlink.addRound(6_190_000_000_000, EXPIRY - 2 hours);
    chainlink.addRound(6_240_000_000_000, EXPIRY + 10 minutes);
    assertEq(feed.fixSettlementPrice(EXPIRY), 62_400e18);
  }

  // ------------------------------------------------------------ availability edges

  function testNotExpiredReverts() public {
    vm.warp(EXPIRY - 1);
    vm.expectRevert(abi.encodeWithSelector(ISettlementFeed.NotExpired.selector, EXPIRY, EXPIRY - 1));
    feed.fixSettlementPrice(EXPIRY);
  }

  function testNoRoundPastExpiryYetReverts() public {
    // all rounds before expiry: chainlink hasn't ticked past it yet
    MockChainlinkAggregator cl = new MockChainlinkAggregator(8);
    cl.addRound(6_190_000_000_000, EXPIRY - 2 hours);
    cl.addRound(6_200_000_000_000, EXPIRY - 1 hours);
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(pyth)), BTC_PRICE_ID);
    vm.expectRevert(AnchoredSettlementFeed.ASF_AnchorNotYetAvailable.selector);
    f.fixSettlementPrice(EXPIRY);
  }

  function testExpiryBeforePhaseStartReverts() public {
    // the current phase started after the expiry — first at-or-after round unprovable
    MockChainlinkAggregator cl = new MockChainlinkAggregator(8);
    cl.setPhase(3);
    cl.addRound(6_230_000_000_000, EXPIRY + 5 minutes);
    cl.addRound(6_250_000_000_000, EXPIRY + 1 hours);
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(pyth)), BTC_PRICE_ID);
    vm.expectRevert(AnchoredSettlementFeed.ASF_ExpiryBeforePhaseStart.selector);
    f.fixSettlementPrice(EXPIRY);
  }

  function testAnchorRoundTooLateReverts() public {
    // first round after expiry is 3h later — beyond the 2h default maxRoundDelay
    MockChainlinkAggregator cl = new MockChainlinkAggregator(8);
    cl.addRound(6_190_000_000_000, EXPIRY - 2 hours);
    cl.addRound(6_250_000_000_000, EXPIRY + 3 hours);
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(pyth)), BTC_PRICE_ID);
    vm.expectRevert(
      abi.encodeWithSelector(
        AnchoredSettlementFeed.ASF_AnchorRoundTooLate.selector, EXPIRY + 3 hours, EXPIRY, 2 hours
      )
    );
    f.fixSettlementPrice(EXPIRY);

    // ... unless the owner widens the bound
    f.setMaxRoundDelay(4 hours);
    assertEq(f.fixSettlementPrice(EXPIRY), 62_500e18);
  }

  function testIncompleteRoundsAreSkipped() public {
    // make round 3 (the natural anchor) incomplete: it must be skipped, round 4 chosen
    chainlink.setRound(1, 3, 0, 0);
    assertEq(feed.fixSettlementPrice(EXPIRY), 62_500e18);
  }

  function testChosenRoundWithNegativeAnswerReverts() public {
    chainlink.setRound(1, 3, -5, EXPIRY + 5 minutes);
    vm.expectRevert(AnchoredSettlementFeed.ASF_IncompleteRound.selector);
    feed.fixSettlementPrice(EXPIRY);
  }

  // ------------------------------------------------------------ decimals

  function testChainlink8To18Decimals() public {
    // 62,300.00000000 (8dp) -> 62,300e18
    assertEq(feed.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  function testChainlink18Decimals() public {
    MockChainlinkAggregator cl = new MockChainlinkAggregator(18);
    cl.addRound(62_000e18, EXPIRY - 1 hours);
    cl.addRound(62_300e18, EXPIRY + 5 minutes);
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(pyth)), BTC_PRICE_ID);
    assertEq(f.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  function testChainlink20Decimals() public {
    MockChainlinkAggregator cl = new MockChainlinkAggregator(20);
    cl.addRound(62_000e20, EXPIRY - 1 hours);
    cl.addRound(62_300e20, EXPIRY + 5 minutes);
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(pyth)), BTC_PRICE_ID);
    assertEq(f.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  // ------------------------------------------------------------ permissionless + immutability

  function testAnyoneCanFix() public {
    vm.prank(address(0xBEEF));
    uint price = feed.fixSettlementPrice(EXPIRY);
    assertEq(price, 62_300e18);
  }

  function testEmitsEvents() public {
    vm.expectEmit(true, false, false, true, address(feed));
    emit SettlementPriceSet(EXPIRY, 62_300e18);
    vm.expectEmit(true, false, false, true, address(feed));
    emit AnchoredSettlementFixed(EXPIRY, uint80((1 << 64) | 3), 62_300e18, address(this));
    feed.fixSettlementPrice(EXPIRY);
  }

  function testCannotFixTwice() public {
    feed.fixSettlementPrice(EXPIRY);
    vm.expectRevert(AnchoredSettlementFeed.ASF_AlreadySettled.selector);
    feed.fixSettlementPrice(EXPIRY);
  }

  function testUnsettledExpiryReadsFalse() public {
    (bool settled, uint price) = feed.getSettlementPrice(EXPIRY + 1 weeks);
    assertFalse(settled);
    assertEq(price, 0);
  }

  // ------------------------------------------------------------ pyth cross-check

  function testPythAgreementPassesNearExpiry() public {
    vm.warp(EXPIRY + 10 minutes); // inside the 30-min check window
    // fresh pyth price within 1% of the 62,300 anchor
    pyth.setPrice(BTC_PRICE_ID, 6_235_000_000_000, 0, -8, block.timestamp);
    assertEq(feed.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  function testPythDisagreementBlocksFixNearExpiry() public {
    vm.warp(EXPIRY + 10 minutes);
    // fresh pyth price 2% away from the anchor
    pyth.setPrice(BTC_PRICE_ID, 6_355_000_000_000, 0, -8, block.timestamp);
    vm.expectRevert(
      abi.encodeWithSelector(AnchoredSettlementFeed.ASF_PythDisagrees.selector, 62_300e18, 63_550e18)
    );
    feed.fixSettlementPrice(EXPIRY);
  }

  function testStalePythSkipsCheck() public {
    vm.warp(EXPIRY + 10 minutes);
    // disagreeing but STALE pyth price (older than 60s) — check skipped, chainlink anchors alone
    pyth.setPrice(BTC_PRICE_ID, 6_355_000_000_000, 0, -8, block.timestamp - 61);
    assertEq(feed.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  function testPythCheckSkippedOutsideWindow() public {
    // default setUp warp is EXPIRY + 2 days: fresh, disagreeing pyth is ignored
    pyth.setPrice(BTC_PRICE_ID, 6_355_000_000_000, 0, -8, block.timestamp);
    assertEq(feed.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  function testNoPythConfiguredSkipsCheck() public {
    MockChainlinkAggregator cl = new MockChainlinkAggregator(8);
    cl.addRound(6_200_000_000_000, EXPIRY - 1 hours);
    cl.addRound(6_230_000_000_000, EXPIRY + 5 minutes);
    AnchoredSettlementFeed f =
      new AnchoredSettlementFeed(IAggregatorV3(address(cl)), IPyth(address(0)), bytes32(0));
    vm.warp(EXPIRY + 10 minutes);
    assertEq(f.fixSettlementPrice(EXPIRY), 62_300e18);
  }

  // ------------------------------------------------------------ owner override (escape hatch)

  function testOverrideFlow() public {
    feed.proposeOverride(EXPIRY, 62_557.95e18);

    // timelocked
    vm.expectRevert(
      abi.encodeWithSelector(
        AnchoredSettlementFeed.ASF_OverrideTimelocked.selector,
        uint64(block.timestamp) + 6 hours,
        block.timestamp
      )
    );
    feed.executeOverride(EXPIRY);

    vm.warp(block.timestamp + 6 hours);
    vm.prank(address(0xBEEF)); // execution is permissionless once matured
    feed.executeOverride(EXPIRY);

    (bool settled, uint price) = feed.getSettlementPrice(EXPIRY);
    assertTrue(settled);
    assertEq(price, 62_557.95e18);
  }

  function testOracleFixPreemptsOverride() public {
    feed.proposeOverride(EXPIRY, 100_000e18);
    vm.warp(block.timestamp + 6 hours);

    // anyone fixes via the oracle path during/after the timelock — override is dead
    vm.prank(address(0xBEEF));
    feed.fixSettlementPrice(EXPIRY);

    vm.expectRevert(AnchoredSettlementFeed.ASF_AlreadySettled.selector);
    feed.executeOverride(EXPIRY);

    (, uint price) = feed.getSettlementPrice(EXPIRY);
    assertEq(price, 62_300e18); // oracle price, not the override
  }

  function testOverrideCannotReplaceFixedPrice() public {
    feed.fixSettlementPrice(EXPIRY);
    vm.expectRevert(AnchoredSettlementFeed.ASF_AlreadySettled.selector);
    feed.proposeOverride(EXPIRY, 100_000e18);
  }

  function testOverrideGuards() public {
    vm.expectRevert(
      abi.encodeWithSelector(ISettlementFeed.NotExpired.selector, EXPIRY + 3 days, block.timestamp)
    );
    feed.proposeOverride(EXPIRY + 3 days, 62_000e18);

    vm.expectRevert(AnchoredSettlementFeed.ASF_InvalidPrice.selector);
    feed.proposeOverride(EXPIRY, 0);

    vm.expectRevert(AnchoredSettlementFeed.ASF_NoOverrideProposal.selector);
    feed.executeOverride(EXPIRY);

    vm.expectRevert(AnchoredSettlementFeed.ASF_NoOverrideProposal.selector);
    feed.cancelOverride(EXPIRY);
  }

  function testCancelOverride() public {
    feed.proposeOverride(EXPIRY, 62_000e18);
    feed.cancelOverride(EXPIRY);
    vm.warp(block.timestamp + 7 hours);
    vm.expectRevert(AnchoredSettlementFeed.ASF_NoOverrideProposal.selector);
    feed.executeOverride(EXPIRY);
  }

  function testReproposeResetsTimelock() public {
    feed.proposeOverride(EXPIRY, 62_000e18);
    vm.warp(block.timestamp + 5 hours);
    feed.proposeOverride(EXPIRY, 62_100e18);
    vm.warp(block.timestamp + 2 hours); // 7h after first proposal, 2h after second
    vm.expectRevert(); // still timelocked (ASF_OverrideTimelocked)
    feed.executeOverride(EXPIRY);
  }

  // ------------------------------------------------------------ owner setters

  function testSettersOnlyOwner() public {
    vm.startPrank(address(0xBEEF));
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setMaxRoundDelay(1 hours);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setPythCheckWindow(1 hours);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setPythStaleness(120);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setDeviationThreshold(0.02e18);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setOverrideDelay(12 hours);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.proposeOverride(EXPIRY, 62_000e18);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.cancelOverride(EXPIRY);
    vm.stopPrank();
  }

  function testSetterBounds() public {
    vm.expectRevert(AnchoredSettlementFeed.ASF_InvalidParam.selector);
    feed.setMaxRoundDelay(0);
    vm.expectRevert(AnchoredSettlementFeed.ASF_InvalidParam.selector);
    feed.setPythStaleness(0);
    vm.expectRevert(AnchoredSettlementFeed.ASF_InvalidParam.selector);
    feed.setDeviationThreshold(0);
    vm.expectRevert(AnchoredSettlementFeed.ASF_InvalidParam.selector);
    feed.setDeviationThreshold(1e18 + 1);
    vm.expectRevert(AnchoredSettlementFeed.ASF_InvalidParam.selector);
    feed.setOverrideDelay(59 minutes);
  }

  function testConstructorGuards() public {
    vm.expectRevert("ASF: aggregator is zero");
    new AnchoredSettlementFeed(IAggregatorV3(address(0)), IPyth(address(pyth)), BTC_PRICE_ID);
    vm.expectRevert("ASF: priceId is zero");
    new AnchoredSettlementFeed(IAggregatorV3(address(chainlink)), IPyth(address(pyth)), bytes32(0));
    // pyth disabled -> zero priceId allowed
    new AnchoredSettlementFeed(IAggregatorV3(address(chainlink)), IPyth(address(0)), bytes32(0));
  }
}
