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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManualPayoutDto = void 0;
var class_validator_1 = require("class-validator");
var recharge_wallet_dto_1 = require("../../wallet/dto/recharge-wallet.dto");
var ManualPayoutDto = (function () {
    function ManualPayoutDto() {
    }
    __decorate([
        (0, class_validator_1.IsString)(),
        (0, class_validator_1.IsNotEmpty)(),
        __metadata("design:type", String)
    ], ManualPayoutDto.prototype, "expertId", void 0);
    __decorate([
        (0, class_validator_1.IsNumber)(),
        (0, class_validator_1.Min)(1),
        __metadata("design:type", Number)
    ], ManualPayoutDto.prototype, "amount", void 0);
    __decorate([
        (0, class_validator_1.IsString)(),
        (0, class_validator_1.IsNotEmpty)(),
        __metadata("design:type", String)
    ], ManualPayoutDto.prototype, "bankAccount", void 0);
    __decorate([
        (0, class_validator_1.IsEnum)(recharge_wallet_dto_1.PaymentMethod),
        __metadata("design:type", String)
    ], ManualPayoutDto.prototype, "paymentMethod", void 0);
    return ManualPayoutDto;
}());
exports.ManualPayoutDto = ManualPayoutDto;
//# sourceMappingURL=manual-payout.dto.js.map