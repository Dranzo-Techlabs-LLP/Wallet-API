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
exports.Session = exports.SessionStatus = void 0;
var typeorm_1 = require("typeorm");
var SessionStatus;
(function (SessionStatus) {
    SessionStatus["ACTIVE"] = "ACTIVE";
    SessionStatus["COMPLETED"] = "COMPLETED";
    SessionStatus["SETTLED"] = "SETTLED";
    SessionStatus["CANCELLED"] = "CANCELLED";
})(SessionStatus = exports.SessionStatus || (exports.SessionStatus = {}));
var Session = (function () {
    function Session() {
    }
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
        __metadata("design:type", String)
    ], Session.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], Session.prototype, "userId", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], Session.prototype, "expertId", void 0);
    __decorate([
        (0, typeorm_1.Column)({ type: 'timestamp' }),
        __metadata("design:type", Date)
    ], Session.prototype, "startTime", void 0);
    __decorate([
        (0, typeorm_1.Column)({ type: 'timestamp', nullable: true }),
        __metadata("design:type", Date)
    ], Session.prototype, "endTime", void 0);
    __decorate([
        (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 2 }),
        __metadata("design:type", Number)
    ], Session.prototype, "expectedFee", void 0);
    __decorate([
        (0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 2, nullable: true }),
        __metadata("design:type", Number)
    ], Session.prototype, "actualFee", void 0);
    __decorate([
        (0, typeorm_1.Column)({
            type: 'enum',
            enum: SessionStatus,
            default: SessionStatus.ACTIVE,
        }),
        __metadata("design:type", String)
    ], Session.prototype, "status", void 0);
    __decorate([
        (0, typeorm_1.CreateDateColumn)(),
        __metadata("design:type", Date)
    ], Session.prototype, "createdAt", void 0);
    __decorate([
        (0, typeorm_1.UpdateDateColumn)(),
        __metadata("design:type", Date)
    ], Session.prototype, "updatedAt", void 0);
    Session = __decorate([
        (0, typeorm_1.Entity)('sessions')
    ], Session);
    return Session;
}());
exports.Session = Session;
//# sourceMappingURL=session.entity.js.map