// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {ChainlinkSpotFeed} from "../src/ChainlinkSpotFeed.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {MockChainlinkAggregator} from "./mocks/MockChainlinkAggregator.sol";

contract ChainlinkSpotFeedTest is Test {
  MockChainlinkAggregator internal aggregator;
  ChainlinkSpotFeed internal feed;

  function setUp() public {
    vm.warp(1_781_000_000);
    aggregator = new MockChainlinkAggregator(8);
    aggregator.setAnswer(12_345_678_900, block.timestamp);
    feed = new ChainlinkSpotFeed(IAggregatorV3(address(aggregator)));
  }

  function testReturnsFreshPriceAt18Decimals() public {
    (uint spot, uint confidence) = feed.getSpot();
    assertEq(spot, 123.456789e18);
    assertEq(confidence, 1e18);
  }

  function testScalesZeroAndTwentyDecimals() public {
    MockChainlinkAggregator zeroDecimals = new MockChainlinkAggregator(0);
    zeroDecimals.setAnswer(123, block.timestamp);
    ChainlinkSpotFeed zeroFeed = new ChainlinkSpotFeed(IAggregatorV3(address(zeroDecimals)));
    (uint zeroSpot,) = zeroFeed.getSpot();
    assertEq(zeroSpot, 123e18);

    MockChainlinkAggregator twentyDecimals = new MockChainlinkAggregator(20);
    twentyDecimals.setAnswer(12_345e20, block.timestamp);
    ChainlinkSpotFeed twentyFeed = new ChainlinkSpotFeed(IAggregatorV3(address(twentyDecimals)));
    (uint twentySpot,) = twentyFeed.getSpot();
    assertEq(twentySpot, 12_345e18);
  }

  function testRejectsMissingRound() public {
    MockChainlinkAggregator empty = new MockChainlinkAggregator(8);
    ChainlinkSpotFeed emptyFeed = new ChainlinkSpotFeed(IAggregatorV3(address(empty)));
    vm.expectRevert(ChainlinkSpotFeed.CSF_InvalidRound.selector);
    emptyFeed.getSpot();
  }

  function testRejectsNonPositiveAnswer() public {
    aggregator.setAnswer(0, block.timestamp);
    vm.expectRevert(ChainlinkSpotFeed.CSF_InvalidPrice.selector);
    feed.getSpot();

    aggregator.setAnswer(-1, block.timestamp);
    vm.expectRevert(ChainlinkSpotFeed.CSF_InvalidPrice.selector);
    feed.getSpot();
  }

  function testRejectsIncompleteRound() public {
    uint80 roundId = aggregator.addRound(12_345_678_900, block.timestamp);
    aggregator.setAnsweredInRound(roundId, roundId - 1);
    vm.expectRevert(ChainlinkSpotFeed.CSF_InvalidRound.selector);
    feed.getSpot();
  }

  function testRejectsFutureRound() public {
    aggregator.setAnswer(12_345_678_900, block.timestamp + 1);
    vm.expectRevert(ChainlinkSpotFeed.CSF_InvalidRound.selector);
    feed.getSpot();
  }

  function testRejectsStaleRoundOutsideConfiguredBound() public {
    vm.warp(block.timestamp + 24 hours);
    feed.getSpot();

    vm.warp(block.timestamp + 1);
    vm.expectRevert(ChainlinkSpotFeed.CSF_StalePrice.selector);
    feed.getSpot();
  }

  function testOwnerCanSetStaleness() public {
    feed.setStaleness(2 days);
    vm.warp(block.timestamp + 2 days);
    feed.getSpot();

    vm.expectRevert(ChainlinkSpotFeed.CSF_InvalidStaleness.selector);
    feed.setStaleness(0);

    vm.prank(address(0xBEEF));
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setStaleness(1 hours);
  }

  function testConstructorGuards() public {
    vm.expectRevert(ChainlinkSpotFeed.CSF_InvalidAggregator.selector);
    new ChainlinkSpotFeed(IAggregatorV3(address(0)));

    MockChainlinkAggregator unsupported = new MockChainlinkAggregator(37);
    vm.expectRevert(ChainlinkSpotFeed.CSF_UnsupportedDecimals.selector);
    new ChainlinkSpotFeed(IAggregatorV3(address(unsupported)));
  }
}
