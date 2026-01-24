"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletController = void 0;
var common_1 = require("@nestjs/common");
var wallet_service_1 = require("./wallet.service");
var recharge_wallet_dto_1 = require("./dto/recharge-wallet.dto");
var WalletController = (function () {
    function WalletController(walletService) {
        this.walletService = walletService;
    }
    WalletController.prototype.recharge = function (dto) {
        return this.walletService.recharge(dto);
    };
    WalletController.prototype.getHistory = function (userId, page, pageSize) {
        if (page === void 0) { page = 1; }
        if (pageSize === void 0) { pageSize = 10; }
        return this.walletService.getHistory(userId, Number(page), Number(pageSize));
    };
    __decorate([
        (0, common_1.Post)('recharge'),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [recharge_wallet_dto_1.RechargeWalletDto]),
        __metadata("design:returntype", void 0)
    ], WalletController.prototype, "recharge", null);
    __decorate([
        (0, common_1.Get)('history'),
        __param(0, (0, common_1.Query)('userId')),
        __param(1, (0, common_1.Query)('page')),
        __param(2, (0, common_1.Query)('pageSize')),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String, Number, Number]),
        __metadata("design:returntype", void 0)
    ], WalletController.prototype, "getHistory", null);
    WalletController = __decorate([
        (0, common_1.Controller)('v1/wallet'),
        __metadata("design:paramtypes", [wallet_service_1.WalletService])
    ], WalletController);
    return WalletController;
}());
exports.WalletController = WalletController;
//# sourceMappingURL=wallet.controller.js.map