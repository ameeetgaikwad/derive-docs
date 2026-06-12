// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {PythSpotFeed} from "../src/PythSpotFeed.sol";
import {IPyth} from "../src/interfaces/IPyth.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {MockPyth} from "./mocks/MockPyth.sol";
import {MockChainlinkAggregator} from "./mocks/MockChainlinkAggregator.sol";

contract PythSpotFeedTest is Test {
  bytes32 internal constant BTC_PRICE_ID = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;

  MockPyth internal pyth;
  MockChainlinkAggregator internal chainlink; // 8 decimals, like the real BTC/USD aggregator
  PythSpotFeed internal feed;

  function setUp() public {
    vm.warp(1_781_000_000);
    pyth = new MockPyth();
    chainlink = new MockChainlinkAggregator(8);
    feed = new PythSpotFeed(IPyth(address(pyth)), BTC_PRICE_ID, IAggregatorV3(address(chainlink)));

    // fresh, agreeing prices: pyth 62,000.00 (expo -8), conf 31.00 (0.05%), chainlink 62,010
    pyth.setPrice(BTC_PRICE_ID, 6_200_000_000_000, 3_100_000_000, -8, block.timestamp);
    chainlink.setAnswer(6_201_000_000_000, block.timestamp);
  }

  // ---------------------------------------------------------------- happy path

  function testHappyPath() public {
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 62_000e18);
    // conf interval 31 / 62,000 = 0.05% -> confidence = 1e18 - 0.0005e18
    assertEq(conf, 0.9995e18);
  }

  function testHappyPathWithoutChainlink() public {
    feed.setChainlinkAggregator(IAggregatorV3(address(0)));
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 62_000e18);
    assertEq(conf, 0.9995e18);
  }

  function testZeroConfInterval() public {
    pyth.setPrice(BTC_PRICE_ID, 6_200_000_000_000, 0, -8, block.timestamp);
    (, uint conf) = feed.getSpot();
    assertEq(conf, 1e18);
  }

  function testHugeConfIntervalFloorsAtZero() public {
    // conf interval wider than the price itself -> confidence floored at 0
    pyth.setPrice(BTC_PRICE_ID, 6_200_000_000_000, 7_000_000_000_000, -8, block.timestamp);
    (, uint conf) = feed.getSpot();
    assertEq(conf, 0);
  }

  // ---------------------------------------------------------------- staleness

  function testStalePythReverts() public {
    vm.warp(block.timestamp + 61); // default staleness 60s
    vm.expectRevert(PythSpotFeed.PSF_StalePythPrice.selector);
    feed.getSpot();
  }

  function testFreshAtExactStalenessBound() public {
    vm.warp(block.timestamp + 60);
    (uint spot,) = feed.getSpot();
    assertEq(spot, 62_000e18);
  }

  function testStalenessBoundIsSettable() public {
    feed.setPythStaleness(300);
    vm.warp(block.timestamp + 200);
    (uint spot,) = feed.getSpot(); // would be stale under the 60s default
    assertEq(spot, 62_000e18);
  }

  function testStaleChainlinkZeroesConfidence() public {
    // pyth fresh, chainlink older than chainlinkStaleness -> breaker trips
    vm.warp(block.timestamp + 24 hours + 1);
    pyth.setPrice(BTC_PRICE_ID, 6_200_000_000_000, 3_100_000_000, -8, block.timestamp);
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 62_000e18);
    assertEq(conf, 0);
  }

  // ---------------------------------------------------------------- non-positive prices

  function testNegativePythPriceReverts() public {
    pyth.setPrice(BTC_PRICE_ID, -1, 0, -8, block.timestamp);
    vm.expectRevert(PythSpotFeed.PSF_InvalidPythPrice.selector);
    feed.getSpot();
  }

  function testZeroPythPriceReverts() public {
    pyth.setPrice(BTC_PRICE_ID, 0, 0, -8, block.timestamp);
    vm.expectRevert(PythSpotFeed.PSF_InvalidPythPrice.selector);
    feed.getSpot();
  }

  function testNegativeChainlinkAnswerZeroesConfidence() public {
    chainlink.setAnswer(-1, block.timestamp);
    (, uint conf) = feed.getSpot();
    assertEq(conf, 0);
  }

  // ---------------------------------------------------------------- deviation breaker

  function testDeviationWithinThresholdKeepsConfidence() public {
    // 0.9% above chainlink — inside the 1% default
    chainlink.setAnswer(6_200_000_000_000, block.timestamp);
    pyth.setPrice(BTC_PRICE_ID, 6_255_800_000_000, 0, -8, block.timestamp);
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 62_558e18);
    assertEq(conf, 1e18);
  }

  function testDeviationAboveThresholdZeroesConfidence() public {
    // 2% above chainlink
    chainlink.setAnswer(6_200_000_000_000, block.timestamp);
    pyth.setPrice(BTC_PRICE_ID, 6_324_000_000_000, 0, -8, block.timestamp);
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 63_240e18);
    assertEq(conf, 0);
  }

  function testDeviationBelowChainlinkZeroesConfidence() public {
    // 2% below chainlink (deviation is symmetric)
    chainlink.setAnswer(6_200_000_000_000, block.timestamp);
    pyth.setPrice(BTC_PRICE_ID, 6_076_000_000_000, 0, -8, block.timestamp);
    (, uint conf) = feed.getSpot();
    assertEq(conf, 0);
  }

  function testDeviationThresholdIsSettable() public {
    feed.setDeviationThreshold(0.05e18); // 5%
    chainlink.setAnswer(6_200_000_000_000, block.timestamp);
    pyth.setPrice(BTC_PRICE_ID, 6_324_000_000_000, 0, -8, block.timestamp); // 2% off
    (, uint conf) = feed.getSpot();
    assertEq(conf, 1e18);
  }

  // ---------------------------------------------------------------- decimals

  function testPythExpoMinus5() public {
    pyth.setPrice(BTC_PRICE_ID, 6_200_000_000, 3_100_000, -5, block.timestamp); // 62,000.00000, conf 31.0
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 62_000e18);
    assertEq(conf, 0.9995e18);
  }

  function testPythExpoZero() public {
    pyth.setPrice(BTC_PRICE_ID, 62_000, 31, 0, block.timestamp);
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 62_000e18);
    assertEq(conf, 0.9995e18);
  }

  function testPythExpoPlus2() public {
    pyth.setPrice(BTC_PRICE_ID, 620, 0, 2, block.timestamp); // 620 * 10^2 = 62,000
    (uint spot,) = feed.getSpot();
    assertEq(spot, 62_000e18);
  }

  function testChainlink18Decimals() public {
    chainlink.setDecimals(18);
    chainlink.setAnswer(62_000e18, block.timestamp);
    (uint spot, uint conf) = feed.getSpot();
    assertEq(spot, 62_000e18);
    assertEq(conf, 0.9995e18); // within threshold, conf untouched
  }

  function testChainlink20Decimals() public {
    chainlink.setDecimals(20);
    chainlink.setAnswer(62_000e20, block.timestamp);
    (, uint conf) = feed.getSpot();
    assertEq(conf, 0.9995e18);
  }

  // ---------------------------------------------------------------- owner setters

  function testSettersOnlyOwner() public {
    vm.startPrank(address(0xBEEF));
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setChainlinkAggregator(IAggregatorV3(address(0)));
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setPythStaleness(120);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setChainlinkStaleness(120);
    vm.expectRevert("Ownable: caller is not the owner");
    feed.setDeviationThreshold(0.02e18);
    vm.stopPrank();
  }

  function testSetterBounds() public {
    vm.expectRevert(PythSpotFeed.PSF_InvalidStaleness.selector);
    feed.setPythStaleness(0);
    vm.expectRevert(PythSpotFeed.PSF_InvalidStaleness.selector);
    feed.setChainlinkStaleness(0);
    vm.expectRevert(PythSpotFeed.PSF_InvalidDeviationThreshold.selector);
    feed.setDeviationThreshold(0);
    vm.expectRevert(PythSpotFeed.PSF_InvalidDeviationThreshold.selector);
    feed.setDeviationThreshold(1e18 + 1);
  }

  function testConstructorGuards() public {
    vm.expectRevert("PSF: pyth is zero");
    new PythSpotFeed(IPyth(address(0)), BTC_PRICE_ID, IAggregatorV3(address(0)));
    vm.expectRevert("PSF: priceId is zero");
    new PythSpotFeed(IPyth(address(pyth)), bytes32(0), IAggregatorV3(address(0)));
  }
}
