// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

import {IScaledUiToken} from "./interfaces/IScaledUiToken.sol";

/**
 * @notice Permissionless history of BEP-8056 UI multipliers. A settlement feed uses
 *         the checkpoint effective at option expiry, never the token's later live value.
 */
contract MultiplierCheckpointRegistry {
  struct Checkpoint {
    uint64 effectiveAt;
    uint192 multiplier;
  }

  IScaledUiToken public immutable token;
  Checkpoint[] internal checkpoints;
  Checkpoint internal pendingCheckpoint;
  bool public hasPendingCheckpoint;

  event MultiplierCheckpointed(uint64 indexed effectiveAt, uint multiplier);
  event PendingMultiplierCheckpointed(uint64 indexed effectiveAt, uint multiplier);
  event PendingMultiplierReplaced(
    uint64 indexed oldEffectiveAt,
    uint oldMultiplier,
    uint64 indexed newEffectiveAt,
    uint newMultiplier
  );

  error MCR_InvalidMultiplier();
  error MCR_InvalidEffectiveTime();
  error MCR_ConflictingCheckpoint();
  error MCR_StalePendingCheckpoint();
  error MCR_CheckpointOutOfBounds();

  constructor(IScaledUiToken _token) {
    require(address(_token) != address(0), "MCR: token is zero");
    token = _token;
    _recordFinal(0, _token.uiMultiplier());
  }

  function checkpointCurrent() external returns (uint multiplier) {
    multiplier = token.uiMultiplier();
    _reconcilePending(multiplier);
    if (multiplierAt(uint64(block.timestamp)) != multiplier) {
      uint rawEffectiveAt = token.effectiveAt();
      uint announcedMultiplier = token.newUIMultiplier();
      uint64 effectiveAt = rawEffectiveAt <= block.timestamp
        && rawEffectiveAt <= type(uint64).max
        && announcedMultiplier == multiplier
        ? uint64(rawEffectiveAt)
        : uint64(block.timestamp);
      _recordFinal(effectiveAt, multiplier);
    }
  }

  function checkpointPending() external returns (uint multiplier, uint64 timestamp) {
    _reconcilePending(token.uiMultiplier());
    multiplier = token.newUIMultiplier();
    uint rawTimestamp = token.effectiveAt();
    if (rawTimestamp > type(uint64).max || rawTimestamp <= block.timestamp) {
      revert MCR_InvalidEffectiveTime();
    }
    timestamp = uint64(rawTimestamp);
    if (multiplier == 0 || multiplier > type(uint192).max) revert MCR_InvalidMultiplier();

    if (hasPendingCheckpoint) {
      Checkpoint memory previous = pendingCheckpoint;
      if (previous.effectiveAt == timestamp && previous.multiplier == multiplier) return (multiplier, timestamp);
      pendingCheckpoint = Checkpoint({effectiveAt: timestamp, multiplier: uint192(multiplier)});
      emit PendingMultiplierReplaced(
        previous.effectiveAt, previous.multiplier, timestamp, multiplier
      );
      return (multiplier, timestamp);
    }

    pendingCheckpoint = Checkpoint({effectiveAt: timestamp, multiplier: uint192(multiplier)});
    hasPendingCheckpoint = true;
    emit PendingMultiplierCheckpointed(timestamp, multiplier);
  }

  function checkpointCount() external view returns (uint) {
    return checkpoints.length + (hasPendingCheckpoint ? 1 : 0);
  }

  function checkpointAt(uint index) external view returns (Checkpoint memory) {
    if (index < checkpoints.length) return checkpoints[index];
    if (hasPendingCheckpoint && index == checkpoints.length) return pendingCheckpoint;
    revert MCR_CheckpointOutOfBounds();
  }

  function currentMultiplier() external view returns (uint) {
    return token.uiMultiplier();
  }

  function multiplierAt(uint64 timestamp) public view returns (uint) {
    if (hasPendingCheckpoint) {
      Checkpoint memory pending = pendingCheckpoint;
      if (pending.effectiveAt <= timestamp) {
        bool stillAnnounced = token.newUIMultiplier() == pending.multiplier
          && token.effectiveAt() == pending.effectiveAt;
        bool alreadyEffective = block.timestamp >= pending.effectiveAt
          && token.uiMultiplier() == pending.multiplier;
        if (!stillAnnounced && !alreadyEffective) revert MCR_StalePendingCheckpoint();
        return pending.multiplier;
      }
    }
    for (uint i = checkpoints.length; i > 0; i--) {
      Checkpoint memory point = checkpoints[i - 1];
      if (point.effectiveAt <= timestamp) return point.multiplier;
    }
    revert MCR_InvalidEffectiveTime();
  }

  /**
   * Reconcile the replaceable issuer schedule before mutating finalized history.
   * A superseded future checkpoint is discarded. Once a scheduled value is live,
   * it is finalized at the issuer-provided effective timestamp.
   */
  function _reconcilePending(uint currentMultiplier_) internal {
    if (!hasPendingCheckpoint) return;
    Checkpoint memory pending = pendingCheckpoint;
    uint announcedMultiplier = token.newUIMultiplier();
    uint announcedEffectiveAt = token.effectiveAt();
    bool stillAnnounced = announcedMultiplier == pending.multiplier
      && announcedEffectiveAt == pending.effectiveAt;

    if (block.timestamp >= pending.effectiveAt && currentMultiplier_ == pending.multiplier) {
      delete pendingCheckpoint;
      hasPendingCheckpoint = false;
      _recordFinal(pending.effectiveAt, pending.multiplier);
      return;
    }

    if (!stillAnnounced) {
      // The issuer replaced this schedule before it took effect. Leaving it in
      // history would make settlement use a multiplier the token never applied.
      delete pendingCheckpoint;
      hasPendingCheckpoint = false;
    }
  }

  function _recordFinal(uint64 timestamp, uint multiplier) internal {
    if (multiplier == 0 || multiplier > type(uint192).max) revert MCR_InvalidMultiplier();
    Checkpoint memory latest = checkpoints.length == 0
      ? Checkpoint({effectiveAt: 0, multiplier: 0})
      : checkpoints[checkpoints.length - 1];
    if (checkpoints.length != 0) {
      if (timestamp < latest.effectiveAt) revert MCR_InvalidEffectiveTime();
      if (timestamp == latest.effectiveAt) {
        if (latest.multiplier != multiplier) revert MCR_ConflictingCheckpoint();
        return;
      }
      if (latest.multiplier == multiplier) return;
    }
    checkpoints.push(Checkpoint({effectiveAt: timestamp, multiplier: uint192(multiplier)}));
    emit MultiplierCheckpointed(timestamp, multiplier);
  }
}
