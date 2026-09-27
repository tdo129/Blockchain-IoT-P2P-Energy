// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SolarToken.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title P2PEnergyMarket - sàn đấu giá điện mặt trời P2P
/// @notice Đơn vị: điện năng = Wh, giá = wei/kWh, thanh toán bằng ETH đã ký quỹ, thưởng bằng token SLR.
///         Tiền phải trả (wei) = energyWh * pricePerKWh / 1000.
///         Hai nguồn lệnh: lệnh tự động từ dữ liệu IoT/AI (có bằng chứng dữ liệu) và lệnh người dùng tự đặt trên web.
contract P2PEnergyMarket is Ownable, ReentrancyGuard {
    SolarToken public rewardToken;
    address public oracle; // backend nối Firebase/AI với blockchain

    /// @notice Thưởng cho người bán: 1 SLR cho mỗi kWh bán được
    uint256 public constant REWARD_PER_KWH = 1;

    /// @notice Số dư ETH ký quỹ (wei). Người mua nạp trước, người bán nhận tiền vào đây rồi tự rút.
    mapping(address => uint256) public balances;

    struct Offer {
        address seller;
        uint256 energyWh;
        uint256 minPricePerKWh;
        bool active;
    }

    struct Bid {
        address buyer;
        uint256 energyWh;
        uint256 maxPricePerKWh;
        bool active;
    }

    Offer[] public offers;
    Bid[] public bids;

    uint256 public currentSession;
    uint256 public sessionDeadline;
    uint256 public sessionDuration;

    /// @notice Các phiên bản mô hình AI được phép tạo lệnh tự động
    mapping(bytes32 => bool) public approvedModels;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event SessionOpened(uint256 indexed sessionId, uint256 deadline);
    event ModelApprovalChanged(bytes32 indexed modelHash, bool approved);
    event ForecastRecorded(
        uint256 indexed sessionId,
        address indexed household,
        uint256 predictedGenerationWh,
        uint256 predictedConsumptionWh,
        bytes32 dataHash,
        bytes32 indexed modelHash
    );
    event OfferSubmitted(
        uint256 indexed sessionId,
        uint256 offerId,
        address indexed seller,
        uint256 energyWh,
        uint256 minPricePerKWh
    );
    event BidSubmitted(
        uint256 indexed sessionId,
        uint256 bidId,
        address indexed buyer,
        uint256 energyWh,
        uint256 maxPricePerKWh
    );
    event Matched(
        uint256 indexed sessionId,
        uint256 offerId,
        uint256 bidId,
        address indexed seller,
        address indexed buyer,
        uint256 energyWh,
        uint256 clearingPricePerKWh,
        uint256 totalCost
    );
    event BidRejected(
        uint256 indexed sessionId,
        uint256 bidId,
        address indexed buyer,
        uint256 requiredCost,
        string reason
    );

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not authorized oracle");
        _;
    }

    modifier sessionOpen() {
        require(block.timestamp < sessionDeadline, "Session closed");
        _;
    }

    constructor(address _rewardToken, address _oracle, uint256 _sessionDuration) Ownable(msg.sender) {
        rewardToken = SolarToken(_rewardToken);
        oracle = _oracle;
        sessionDuration = _sessionDuration;
        _openSession();
    }

    // ---------------- Ký quỹ ETH ----------------

    function deposit() external payable {
        require(msg.value > 0, "Nothing to deposit");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0 && balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------- Nộp lệnh ----------------

    function _openSession() internal {
        currentSession++;
        sessionDeadline = block.timestamp + sessionDuration;
        delete offers;
        delete bids;
        emit SessionOpened(currentSession, sessionDeadline);
    }

    function _addOffer(address seller, uint256 energyWh, uint256 minPricePerKWh) internal {
        require(energyWh > 0, "Energy must be > 0");
        offers.push(Offer(seller, energyWh, minPricePerKWh, true));
        emit OfferSubmitted(currentSession, offers.length - 1, seller, energyWh, minPricePerKWh);
    }

    function _addBid(address buyer, uint256 energyWh, uint256 maxPricePerKWh) internal {
        require(energyWh > 0, "Energy must be > 0");
        bids.push(Bid(buyer, energyWh, maxPricePerKWh, true));
        emit BidSubmitted(currentSession, bids.length - 1, buyer, energyWh, maxPricePerKWh);
    }

    function _recordForecast(
        address household,
        uint256 predictedGenerationWh,
        uint256 predictedConsumptionWh,
        bytes32 dataHash,
        bytes32 modelHash
    ) internal {
        require(approvedModels[modelHash], "Model not approved");
        require(dataHash != bytes32(0), "Missing data hash");
        emit ForecastRecorded(
            currentSession,
            household,
            predictedGenerationWh,
            predictedConsumptionWh,
            dataHash,
            modelHash
        );
    }

    /// @notice Lệnh bán tự động: lượng bán = sản lượng dự báo - tiêu thụ dự báo (contract tự tính)
    function submitOffer(
        address seller,
        uint256 predictedGenerationWh,
        uint256 predictedConsumptionWh,
        uint256 minPricePerKWh,
        bytes32 dataHash,
        bytes32 modelHash
    ) external onlyOracle sessionOpen {
        require(predictedGenerationWh > predictedConsumptionWh, "No surplus");
        _recordForecast(seller, predictedGenerationWh, predictedConsumptionWh, dataHash, modelHash);
        _addOffer(seller, predictedGenerationWh - predictedConsumptionWh, minPricePerKWh);
    }

    /// @notice Lệnh mua tự động: lượng mua = tiêu thụ dự báo - sản lượng dự báo (contract tự tính)
    function submitBid(
        address buyer,
        uint256 predictedGenerationWh,
        uint256 predictedConsumptionWh,
        uint256 maxPricePerKWh,
        bytes32 dataHash,
        bytes32 modelHash
    ) external onlyOracle sessionOpen {
        require(predictedConsumptionWh > predictedGenerationWh, "No deficit");
        _recordForecast(buyer, predictedGenerationWh, predictedConsumptionWh, dataHash, modelHash);
        _addBid(buyer, predictedConsumptionWh - predictedGenerationWh, maxPricePerKWh);
    }

    /// @notice Lệnh bán do người dùng tự đặt trên web (market/asks), oracle chuyển tiếp lên chain
    function submitManualOffer(address seller, uint256 energyWh, uint256 minPricePerKWh)
        external
        onlyOracle
        sessionOpen
    {
        _addOffer(seller, energyWh, minPricePerKWh);
    }

    /// @notice Lệnh mua do người dùng tự đặt trên web (market/bids), oracle chuyển tiếp lên chain
    function submitManualBid(address buyer, uint256 energyWh, uint256 maxPricePerKWh)
        external
        onlyOracle
        sessionOpen
    {
        _addBid(buyer, energyWh, maxPricePerKWh);
    }

    // ---------------- Khớp lệnh ----------------

    /// @notice Khớp lệnh sau khi phiên đóng: greedy theo thứ tự nộp, giá chốt = trung bình giá sàn và giá trần.
    ///         Người mua không đủ ETH ký quỹ bị loại khỏi phiên thay vì làm revert cả hàm (phiên sẽ bị kẹt).
    function matchOrders() external onlyOracle nonReentrant {
        require(block.timestamp >= sessionDeadline, "Session still open");

        for (uint256 i = 0; i < offers.length; i++) {
            Offer storage offer = offers[i];
            if (!offer.active) continue;

            for (uint256 j = 0; j < bids.length; j++) {
                Bid storage bid = bids[j];
                if (!bid.active) continue;
                if (bid.maxPricePerKWh < offer.minPricePerKWh) continue;

                uint256 matchedWh = offer.energyWh < bid.energyWh ? offer.energyWh : bid.energyWh;
                uint256 clearingPrice = (offer.minPricePerKWh + bid.maxPricePerKWh) / 2;
                uint256 totalCost = (matchedWh * clearingPrice) / 1000;

                if (balances[bid.buyer] < totalCost) {
                    bid.active = false;
                    emit BidRejected(currentSession, j, bid.buyer, totalCost, "Insufficient deposit");
                    continue;
                }

                balances[bid.buyer] -= totalCost;
                balances[offer.seller] += totalCost;
                rewardToken.mintReward(offer.seller, matchedWh * REWARD_PER_KWH);

                emit Matched(currentSession, i, j, offer.seller, bid.buyer, matchedWh, clearingPrice, totalCost);

                offer.energyWh -= matchedWh;
                bid.energyWh -= matchedWh;
                if (bid.energyWh == 0) bid.active = false;
                if (offer.energyWh == 0) {
                    offer.active = false;
                    break;
                }
            }
        }
        _openSession();
    }

    // ---------------- Quản trị ----------------

    function setModelApproved(bytes32 modelHash, bool approved) external onlyOwner {
        approvedModels[modelHash] = approved;
        emit ModelApprovalChanged(modelHash, approved);
    }

    function setOracle(address newOracle) external onlyOwner {
        oracle = newOracle;
    }

    function offersCount() external view returns (uint256) {
        return offers.length;
    }

    function bidsCount() external view returns (uint256) {
        return bids.length;
    }
}
