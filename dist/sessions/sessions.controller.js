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
exports.SessionsController = void 0;
var common_1 = require("@nestjs/common");
var sessions_service_1 = require("./sessions.service");
var start_session_dto_1 = require("./dto/start-session.dto");
var adjust_session_dto_1 = require("./dto/adjust-session.dto");
var end_session_dto_1 = require("./dto/end-session.dto");
var SessionsController = (function () {
    function SessionsController(sessionsService) {
        this.sessionsService = sessionsService;
    }
    SessionsController.prototype.start = function (dto) {
        return this.sessionsService.start(dto);
    };
    SessionsController.prototype.adjust = function (dto) {
        return this.sessionsService.adjust(dto);
    };
    SessionsController.prototype.end = function (dto) {
        return this.sessionsService.end(dto);
    };
    __decorate([
        (0, common_1.Post)('start'),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [start_session_dto_1.StartSessionDto]),
        __metadata("design:returntype", void 0)
    ], SessionsController.prototype, "start", null);
    __decorate([
        (0, common_1.Post)('adjust'),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [adjust_session_dto_1.AdjustSessionDto]),
        __metadata("design:returntype", void 0)
    ], SessionsController.prototype, "adjust", null);
    __decorate([
        (0, common_1.Post)('end'),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [end_session_dto_1.EndSessionDto]),
        __metadata("design:returntype", void 0)
    ], SessionsController.prototype, "end", null);
    SessionsController = __decorate([
        (0, common_1.Controller)('v1/sessions'),
        __metadata("design:paramtypes", [sessions_service_1.SessionsService])
    ], SessionsController);
    return SessionsController;
}());
exports.SessionsController = SessionsController;
//# sourceMappingURL=sessions.controller.js.map