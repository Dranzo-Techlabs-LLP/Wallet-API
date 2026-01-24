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
exports.BankDetail = void 0;
var typeorm_1 = require("typeorm");
var expert_entity_1 = require("./expert.entity");
var BankDetail = (function () {
    function BankDetail() {
    }
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
        __metadata("design:type", String)
    ], BankDetail.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], BankDetail.prototype, "expertId", void 0);
    __decorate([
        (0, typeorm_1.ManyToOne)(function () { return expert_entity_1.Expert; }, { onDelete: 'CASCADE' }),
        __metadata("design:type", expert_entity_1.Expert)
    ], BankDetail.prototype, "expert", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], BankDetail.prototype, "bankName", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], BankDetail.prototype, "accountNumber", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], BankDetail.prototype, "ifscCode", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], BankDetail.prototype, "accountHolderName", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: true }),
        __metadata("design:type", String)
    ], BankDetail.prototype, "branchName", void 0);
    __decorate([
        (0, typeorm_1.Column)({ default: true }),
        __metadata("design:type", Boolean)
    ], BankDetail.prototype, "isActive", void 0);
    __decorate([
        (0, typeorm_1.CreateDateColumn)(),
        __metadata("design:type", Date)
    ], BankDetail.prototype, "createdAt", void 0);
    __decorate([
        (0, typeorm_1.UpdateDateColumn)(),
        __metadata("design:type", Date)
    ], BankDetail.prototype, "updatedAt", void 0);
    BankDetail = __decorate([
        (0, typeorm_1.Entity)('bank_details')
    ], BankDetail);
    return BankDetail;
}());
exports.BankDetail = BankDetail;
//# sourceMappingURL=bank-detail.entity.js.map