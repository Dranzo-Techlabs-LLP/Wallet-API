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
exports.Transaction = exports.TransactionStatus = exports.TransactionType = void 0;
var typeorm_1 = require("typeorm");
var TransactionType;
(function (TransactionType) {
    TransactionType["RECHARGE"] = "RECHARGE";
    TransactionType["SESSION_HOLD"] = "SESSION_HOLD";
    TransactionType["SESSION_CAPTURE"] = "SESSION_CAPTURE";
    TransactionType["SESSION_REFUND"] = "SESSION_REFUND";
    TransactionType["PAYOUT"] = "PAYOUT";
    TransactionType["COMMISSION"] = "COMMISSION";
    TransactionType["ADJUSTMENT"] = "ADJUSTMENT";
})(TransactionType = exports.TransactionType || (exports.TransactionType = {}));
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["PENDING"] = "PENDING";
    TransactionStatus["SUCCESS"] = "SUCCESS";
    TransactionStatus["FAILED"] = "FAILED";
})(TransactionStatus = exports.TransactionStatus || (exports.TransactionStatus = {}));
var Transaction = (function () {
    function Transaction() {
    }
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
        __metadata("design:type", String)
    ], Transaction.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: true }),
        __metadata("design:type", String)
    ], Transaction.prototype, "userId", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: true }),
        __metadata("design:type", String)
    ], Transaction.prototype, "expertId", void 0);
    __decorate([
        (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 2 }),
        __metadata("design:type", Number)
    ], Transaction.prototype, "amount", void 0);
    __decorate([
        (0, typeorm_1.Column)({
            type: 'enum',
            enum: TransactionType,
        }),
        __metadata("design:type", String)
    ], Transaction.prototype, "type", void 0);
    __decorate([
        (0, typeorm_1.Column)({
            type: 'enum',
            enum: TransactionStatus,
            default: TransactionStatus.PENDING,
        }),
        __metadata("design:type", String)
    ], Transaction.prototype, "status", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: true }),
        __metadata("design:type", String)
    ], Transaction.prototype, "referenceId", void 0);
    __decorate([
        (0, typeorm_1.Column)({ type: 'json', nullable: true }),
        __metadata("design:type", Object)
    ], Transaction.prototype, "metaData", void 0);
    __decorate([
        (0, typeorm_1.CreateDateColumn)(),
        __metadata("design:type", Date)
    ], Transaction.prototype, "createdAt", void 0);
    __decorate([
        (0, typeorm_1.UpdateDateColumn)(),
        __metadata("design:type", Date)
    ], Transaction.prototype, "updatedAt", void 0);
    Transaction = __decorate([
        (0, typeorm_1.Entity)('transactions')
    ], Transaction);
    return Transaction;
}());
exports.Transaction = Transaction;
//# sourceMappingURL=transaction.entity.js.map