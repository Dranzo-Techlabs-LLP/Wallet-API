"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayoutsModule = void 0;
var common_1 = require("@nestjs/common");
var typeorm_1 = require("@nestjs/typeorm");
var payouts_service_1 = require("./payouts.service");
var payouts_controller_1 = require("./payouts.controller");
var expert_entity_1 = require("../experts/expert.entity");
var transaction_entity_1 = require("../transactions/transaction.entity");
var PayoutsModule = (function () {
    function PayoutsModule() {
    }
    PayoutsModule = __decorate([
        (0, common_1.Module)({
            imports: [typeorm_1.TypeOrmModule.forFeature([expert_entity_1.Expert, transaction_entity_1.Transaction])],
            controllers: [payouts_controller_1.PayoutsController],
            providers: [payouts_service_1.PayoutsService],
        })
    ], PayoutsModule);
    return PayoutsModule;
}());
exports.PayoutsModule = PayoutsModule;
//# sourceMappingURL=payouts.module.js.map