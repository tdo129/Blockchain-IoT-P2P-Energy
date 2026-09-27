const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

// Đơn vị: điện năng = Wh, giá = wei/kWh, thanh toán ETH ký quỹ, thưởng SLR (3 decimals)
const ETH = (amount) => ethers.parseEther(amount.toString());
const SLR = (amount) => ethers.parseUnits(amount.toString(), 3);

describe("P2PEnergyMarket", function () {
  let token, market;
  let deployer, oracle, seller, buyer, stranger, buyer2;
  const SESSION_DURATION = 600;
  const MODEL_HASH = ethers.id("naive-persistence-v1");
  const DATA_HASH = ethers.id('{"nodeId":"node_01","records":[]}');

  const offer = (who, genWh, consWh, price, dataHash = DATA_HASH, modelHash = MODEL_HASH) =>
    market.connect(oracle).submitOffer(who, genWh, consWh, price, dataHash, modelHash);
  const bid = (who, genWh, consWh, price, dataHash = DATA_HASH, modelHash = MODEL_HASH) =>
    market.connect(oracle).submitBid(who, genWh, consWh, price, dataHash, modelHash);

  beforeEach(async function () {
    [deployer, oracle, seller, buyer, stranger, buyer2] = await ethers.getSigners();

    const SolarToken = await ethers.getContractFactory("SolarToken");
    token = await SolarToken.deploy(0);
    await token.waitForDeployment();

    const P2PEnergyMarket = await ethers.getContractFactory("P2PEnergyMarket");
    market = await P2PEnergyMarket.deploy(await token.getAddress(), oracle.address, SESSION_DURATION);
    await market.waitForDeployment();

    await token.transferOwnership(await market.getAddress());
    await market.connect(deployer).setModelApproved(MODEL_HASH, true);

    await market.connect(buyer).deposit({ value: ETH(1) });
  });

  describe("Token thưởng", function () {
    it("là Solar Token (SLR), 3 decimals, như trang My Wallet hiển thị", async function () {
      expect(await token.name()).to.equal("Solar Token");
      expect(await token.symbol()).to.equal("SLR");
      expect(await token.decimals()).to.equal(3);
    });
  });

  describe("Ký quỹ ETH", function () {
    it("nạp ETH làm tăng số dư ký quỹ", async function () {
      await expect(market.connect(buyer2).deposit({ value: ETH("0.5") }))
        .to.emit(market, "Deposited")
        .withArgs(buyer2.address, ETH("0.5"));
      expect(await market.balances(buyer2.address)).to.equal(ETH("0.5"));
    });

    it("không cho nạp 0 ETH", async function () {
      await expect(market.connect(buyer2).deposit({ value: 0 })).to.be.revertedWith("Nothing to deposit");
    });

    it("rút ETH trả tiền về ví và trừ số dư", async function () {
      await expect(market.connect(buyer).withdraw(ETH("0.4"))).to.changeEtherBalances(
        [buyer, market],
        [ETH("0.4"), -ETH("0.4")]
      );
      expect(await market.balances(buyer.address)).to.equal(ETH("0.6"));
    });

    it("không cho rút quá số dư", async function () {
      await expect(market.connect(buyer).withdraw(ETH(2))).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Phân quyền", function () {
    it("chỉ oracle mới được nộp lệnh tự động", async function () {
      await expect(
        market.connect(stranger).submitOffer(seller.address, 1800, 1300, ETH("0.05"), DATA_HASH, MODEL_HASH)
      ).to.be.revertedWith("Not authorized oracle");
      await expect(
        market.connect(stranger).submitBid(buyer.address, 400, 1000, ETH("0.06"), DATA_HASH, MODEL_HASH)
      ).to.be.revertedWith("Not authorized oracle");
    });

    it("chỉ oracle mới được chuyển tiếp lệnh thủ công", async function () {
      await expect(
        market.connect(stranger).submitManualOffer(seller.address, 500, ETH("0.05"))
      ).to.be.revertedWith("Not authorized oracle");
      await expect(
        market.connect(stranger).submitManualBid(buyer.address, 500, ETH("0.06"))
      ).to.be.revertedWith("Not authorized oracle");
    });

    it("chỉ owner mới đổi được oracle và duyệt mô hình", async function () {
      await expect(market.connect(stranger).setOracle(stranger.address)).to.be.reverted;
      await expect(market.connect(stranger).setModelApproved(ethers.id("fake"), true)).to.be.reverted;
    });
  });

  describe("Lệnh tự động từ dữ liệu IoT/AI", function () {
    it("contract tự tính lượng bán = sản lượng - tiêu thụ", async function () {
      await offer(seller.address, 1800, 1300, ETH("0.05"));
      const o = await market.offers(0);
      expect(o.energyWh).to.equal(500);
      expect(o.minPricePerKWh).to.equal(ETH("0.05"));
    });

    it("contract tự tính lượng mua = tiêu thụ - sản lượng", async function () {
      await bid(buyer.address, 400, 1000, ETH("0.06"));
      expect((await market.bids(0)).energyWh).to.equal(600);
    });

    it("ghi dự báo, hash dữ liệu và hash mô hình vào event ForecastRecorded", async function () {
      await expect(offer(seller.address, 1800, 1300, ETH("0.05")))
        .to.emit(market, "ForecastRecorded")
        .withArgs(1, seller.address, 1800, 1300, DATA_HASH, MODEL_HASH)
        .and.to.emit(market, "OfferSubmitted")
        .withArgs(1, 0, seller.address, 500, ETH("0.05"));
    });

    it("từ chối lệnh bán khi không có điện dư, lệnh mua khi không thiếu điện", async function () {
      await expect(offer(seller.address, 1000, 1000, ETH("0.05"))).to.be.revertedWith("No surplus");
      await expect(bid(buyer.address, 1000, 800, ETH("0.06"))).to.be.revertedWith("No deficit");
    });

    it("từ chối mô hình chưa duyệt hoặc đã bị thu hồi", async function () {
      await expect(
        offer(seller.address, 1800, 1300, ETH("0.05"), DATA_HASH, ethers.id("unknown"))
      ).to.be.revertedWith("Model not approved");
      await market.connect(deployer).setModelApproved(MODEL_HASH, false);
      await expect(offer(seller.address, 1800, 1300, ETH("0.05"))).to.be.revertedWith("Model not approved");
    });

    it("từ chối lệnh thiếu hash dữ liệu", async function () {
      await expect(offer(seller.address, 1800, 1300, ETH("0.05"), ethers.ZeroHash)).to.be.revertedWith(
        "Missing data hash"
      );
    });
  });

  describe("Lệnh thủ công từ web", function () {
    it("ghi nhận lệnh bán/mua thủ công, không phát ForecastRecorded", async function () {
      await expect(market.connect(oracle).submitManualOffer(seller.address, 224200, ETH("0.058")))
        .to.emit(market, "OfferSubmitted")
        .withArgs(1, 0, seller.address, 224200, ETH("0.058"))
        .and.to.not.emit(market, "ForecastRecorded");
      await market.connect(oracle).submitManualBid(buyer.address, 263700, ETH("0.055"));
      expect((await market.bids(0)).energyWh).to.equal(263700);
    });

    it("từ chối lượng điện bằng 0", async function () {
      await expect(market.connect(oracle).submitManualOffer(seller.address, 0, ETH("0.05"))).to.be.revertedWith(
        "Energy must be > 0"
      );
    });
  });

  describe("Phiên đấu giá", function () {
    it("không cho nộp lệnh sau khi phiên đã đóng", async function () {
      await time.increase(SESSION_DURATION + 1);
      await expect(offer(seller.address, 1800, 1300, ETH("0.05"))).to.be.revertedWith("Session closed");
      await expect(market.connect(oracle).submitManualBid(buyer.address, 500, ETH("0.06"))).to.be.revertedWith(
        "Session closed"
      );
    });

    it("không cho khớp lệnh khi phiên chưa đóng", async function () {
      await expect(market.connect(oracle).matchOrders()).to.be.revertedWith("Session still open");
    });

    it("mở phiên mới sau khi khớp lệnh", async function () {
      await time.increase(SESSION_DURATION + 1);
      await expect(market.connect(oracle).matchOrders()).to.emit(market, "SessionOpened").withArgs(2, anyValue);
      expect(await market.currentSession()).to.equal(2);
    });
  });

  describe("Khớp lệnh và thanh toán ETH", function () {
    it("khớp khi giá trần >= giá sàn: chuyển ETH ký quỹ và thưởng SLR", async function () {
      await offer(seller.address, 1800, 1300, ETH("0.05")); // bán 500 Wh, sàn 0.05 ETH/kWh
      await bid(buyer.address, 700, 1200, ETH("0.06")); // mua 500 Wh, trần 0.06 -> chốt 0.055
      await time.increase(SESSION_DURATION + 1);

      const cost = ETH("0.0275"); // 0.5 kWh × 0.055 ETH/kWh
      await expect(market.connect(oracle).matchOrders())
        .to.emit(market, "Matched")
        .withArgs(1, 0, 0, seller.address, buyer.address, 500, ETH("0.055"), cost);

      expect(await market.balances(buyer.address)).to.equal(ETH(1) - cost);
      expect(await market.balances(seller.address)).to.equal(cost);
      expect(await token.balanceOf(seller.address)).to.equal(SLR("0.5")); // 0.5 kWh × 1 SLR/kWh
    });

    it("người bán rút được tiền đã bán", async function () {
      await offer(seller.address, 1800, 1300, ETH("0.05"));
      await bid(buyer.address, 700, 1200, ETH("0.06"));
      await time.increase(SESSION_DURATION + 1);
      await market.connect(oracle).matchOrders();

      await expect(market.connect(seller).withdraw(ETH("0.0275"))).to.changeEtherBalance(seller, ETH("0.0275"));
    });

    it("không khớp khi giá trần thấp hơn giá sàn", async function () {
      await offer(seller.address, 1800, 1300, ETH("0.06"));
      await bid(buyer.address, 700, 1200, ETH("0.05"));
      await time.increase(SESSION_DURATION + 1);

      await expect(market.connect(oracle).matchOrders()).to.not.emit(market, "Matched");
      expect(await market.balances(seller.address)).to.equal(0);
    });

    it("khớp một phần khi lượng bán ít hơn lượng mua", async function () {
      await offer(seller.address, 1000, 700, ETH("0.05")); // bán 300 Wh
      await bid(buyer.address, 500, 1000, ETH("0.07")); // mua 500 Wh -> chốt 0.06
      await time.increase(SESSION_DURATION + 1);

      await expect(market.connect(oracle).matchOrders())
        .to.emit(market, "Matched")
        .withArgs(1, 0, 0, seller.address, buyer.address, 300, ETH("0.06"), ETH("0.018"));
    });
  });

  describe("Người mua không đủ ký quỹ (không làm kẹt phiên)", function () {
    it("loại người mua, phiên vẫn kết thúc và mở phiên mới", async function () {
      await offer(seller.address, 1800, 1300, ETH("0.05"));
      await bid(stranger.address, 700, 1200, ETH("0.06")); // stranger chưa nạp ETH
      await time.increase(SESSION_DURATION + 1);

      await expect(market.connect(oracle).matchOrders())
        .to.emit(market, "BidRejected")
        .withArgs(1, 0, stranger.address, ETH("0.0275"), "Insufficient deposit")
        .and.to.not.emit(market, "Matched");
      expect(await market.currentSession()).to.equal(2);
    });

    it("bỏ qua người mua không đủ tiền và khớp tiếp với người sau", async function () {
      await offer(seller.address, 1800, 1300, ETH("0.05"));
      await bid(stranger.address, 700, 1200, ETH("0.06"));
      await bid(buyer.address, 700, 1200, ETH("0.06"));
      await time.increase(SESSION_DURATION + 1);

      await expect(market.connect(oracle).matchOrders())
        .to.emit(market, "BidRejected")
        .withArgs(1, 0, stranger.address, ETH("0.0275"), "Insufficient deposit")
        .and.to.emit(market, "Matched")
        .withArgs(1, 0, 1, seller.address, buyer.address, 500, ETH("0.055"), ETH("0.0275"));
    });
  });
});
