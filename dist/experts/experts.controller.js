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
exports.ExpertsController = void 0;
var common_1 = require("@nestjs/common");
var experts_service_1 = require("./experts.service");
var add_bank_detail_dto_1 = require("./dto/add-bank-detail.dto");
var ExpertsController = (function () {
    function ExpertsController(expertsService) {
        this.expertsService = expertsService;
    }
    ExpertsController.prototype.addBankDetail = function (dto) {
        return this.expertsService.addBankDetail(dto);
    };
    ExpertsController.prototype.getBankDetails = function (expertId) {
        return this.expertsService.getBankDetails(expertId);
    };
    __decorate([
        (0, common_1.Post)('bank-details'),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [add_bank_detail_dto_1.AddBankDetailDto]),
        __metadata("design:returntype", void 0)
    ], ExpertsController.prototype, "addBankDetail", null);
    __decorate([
        (0, common_1.Get)(':expertId/bank-details'),
        __param(0, (0, common_1.Param)('expertId')),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String]),
        __metadata("design:returntype", void 0)
    ], ExpertsController.prototype, "getBankDetails", null);
    ExpertsController = __decorate([
        (0, common_1.Controller)('v1/experts'),
        __metadata("design:paramtypes", [experts_service_1.ExpertsService])
    ], ExpertsController);
    return ExpertsController;
}());
exports.ExpertsController = ExpertsController;
//# sourceMappingURL=experts.controller.js.map