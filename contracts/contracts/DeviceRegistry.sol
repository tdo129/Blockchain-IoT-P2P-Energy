// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DeviceRegistry - ánh xạ địa chỉ ví (hộ gia đình) với thiết bị IoT (ESP32/Raspberry Pi)
contract DeviceRegistry is Ownable {
    mapping(address => bool) public isRegistered;
    mapping(address => string) public deviceId;

    event DeviceRegistered(address indexed owner, string deviceId);

    constructor() Ownable(msg.sender) {}

    function registerDevice(address owner, string calldata _deviceId) external onlyOwner {
        isRegistered[owner] = true;
        deviceId[owner] = _deviceId;
        emit DeviceRegistered(owner, _deviceId);
    }
}
