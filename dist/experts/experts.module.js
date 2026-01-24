"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpertsModule = void 0;
var common_1 = require("@nestjs/common");
var typeorm_1 = require("@nestjs/typeorm");
var expert_entity_1 = require("./expert.entity");
var bank_detail_entity_1 = require("./bank-detail.entity");
var experts_service_1 = require("./experts.service");
var experts_controller_1 = require("./experts.controller");
var ExpertsModule = (function () {
    function ExpertsModule() {
    }
    ExpertsModule = __decorate([
        (0, common_1.Module)({
            imports: [typeorm_1.TypeOrmModule.forFeature([expert_entity_1.Expert, bank_detail_entity_1.BankDetail])],
            providers: [experts_service_1.ExpertsService],
            controllers: [experts_controller_1.ExpertsController],
            exports: [typeorm_1.TypeOrmModule],
        })
    ], ExpertsModule);
    return ExpertsModule;
}());
exports.ExpertsModule = ExpertsModule;
//# sourceMappingURL=experts.module.js.map