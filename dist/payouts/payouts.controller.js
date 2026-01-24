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
exports.PayoutsController = void 0;
var common_1 = require("@nestjs/common");
var payouts_service_1 = require("./payouts.service");
var manual_payout_dto_1 = require("./dto/manual-payout.dto");
var monthly_payout_dto_1 = require("./dto/monthly-payout.dto");
var PayoutsController = (function () {
    function PayoutsController(payoutsService) {
        this.payoutsService = payoutsService;
    }
    PayoutsController.prototype.manual = function (dto) {
        return this.payoutsService.manualPayout(dto);
    };
    PayoutsController.prototype.monthly = function (dto) {
        return this.payoutsService.monthlyPayout(dto);
    };
    __decorate([
        (0, common_1.Post)('manual'),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [manual_payout_dto_1.ManualPayoutDto]),
        __metadata("design:returntype", void 0)
    ], PayoutsController.prototype, "manual", null);
    __decorate([
        (0, common_1.Post)('monthly'),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [monthly_payout_dto_1.MonthlyPayoutDto]),
        __metadata("design:returntype", void 0)
    ], PayoutsController.prototype, "monthly", null);
    PayoutsController = __decorate([
        (0, common_1.Controller)('v1/payouts'),
        __metadata("design:paramtypes", [payouts_service_1.PayoutsService])
    ], PayoutsController);
    return PayoutsController;
}());
exports.PayoutsController = PayoutsController;
//# sourceMappingURL=payouts.controller.js.map