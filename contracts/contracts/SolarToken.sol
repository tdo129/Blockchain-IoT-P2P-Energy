// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SolarToken (SLR) - token thưởng cho hộ bán điện, trùng tên/ký hiệu hiển thị ở trang My Wallet của frontend
contract SolarToken is ERC20, Ownable {
    constructor(uint256 initialSupply) ERC20("Solar Token", "SLR") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /// @dev 3 decimals: đơn vị nhỏ nhất là 0.001 SLR, nên thưởng Wh × (SLR/kWh) ra đúng số đơn vị nhỏ nhất.
    function decimals() public pure override returns (uint8) {
        return 3;
    }

    /// @notice Thưởng token cho hộ bán điện thành công. Chỉ owner (contract Market) gọi được.
    function mintReward(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
