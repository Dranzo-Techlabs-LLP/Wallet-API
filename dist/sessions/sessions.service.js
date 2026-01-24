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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionsService = void 0;
var common_1 = require("@nestjs/common");
var typeorm_1 = require("@nestjs/typeorm");
var typeorm_2 = require("typeorm");
var session_entity_1 = require("./session.entity");
var user_entity_1 = require("../users/user.entity");
var expert_entity_1 = require("../experts/expert.entity");
var transaction_entity_1 = require("../transactions/transaction.entity");
var SessionsService = (function () {
    function SessionsService(sessionRepository, userRepository, expertRepository, transactionRepository, connection) {
        this.sessionRepository = sessionRepository;
        this.userRepository = userRepository;
        this.expertRepository = expertRepository;
        this.transactionRepository = transactionRepository;
        this.connection = connection;
    }
    SessionsService.prototype.start = function (dto) {
        return __awaiter(this, void 0, void 0, function () {
            var userId, expertId, sessionFee, queryRunner, user, availableCredits, session, holdTransaction, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        userId = dto.userId, expertId = dto.expertId, sessionFee = dto.sessionFee;
                        queryRunner = this.connection.createQueryRunner();
                        return [4, queryRunner.connect()];
                    case 1:
                        _a.sent();
                        return [4, queryRunner.startTransaction()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 9, 11, 13]);
                        return [4, queryRunner.manager.findOne(user_entity_1.User, { where: { id: userId } })];
                    case 4:
                        user = _a.sent();
                        if (!user)
                            throw new common_1.NotFoundException('User not found');
                        availableCredits = Number(user.max_credits) - Number(user.current_hold);
                        if (availableCredits < sessionFee) {
                            throw new common_1.BadRequestException('Insufficient credits');
                        }
                        session = this.sessionRepository.create({
                            userId: userId,
                            expertId: expertId,
                            startTime: new Date(),
                            expectedFee: sessionFee,
                            status: session_entity_1.SessionStatus.ACTIVE,
                        });
                        return [4, queryRunner.manager.save(session)];
                    case 5:
                        _a.sent();
                        holdTransaction = this.transactionRepository.create({
                            userId: userId,
                            expertId: expertId,
                            amount: sessionFee,
                            type: transaction_entity_1.TransactionType.SESSION_HOLD,
                            status: transaction_entity_1.TransactionStatus.SUCCESS,
                            referenceId: session.id,
                        });
                        return [4, queryRunner.manager.save(holdTransaction)];
                    case 6:
                        _a.sent();
                        user.current_hold = Number(user.current_hold) + Number(sessionFee);
                        return [4, queryRunner.manager.save(user)];
                    case 7:
                        _a.sent();
                        return [4, queryRunner.commitTransaction()];
                    case 8:
                        _a.sent();
                        return [2, session];
                    case 9:
                        err_1 = _a.sent();
                        return [4, queryRunner.rollbackTransaction()];
                    case 10:
                        _a.sent();
                        throw err_1;
                    case 11: return [4, queryRunner.release()];
                    case 12:
                        _a.sent();
                        return [7];
                    case 13: return [2];
                }
            });
        });
    };
    SessionsService.prototype.adjust = function (dto) {
        return __awaiter(this, void 0, void 0, function () {
            var sessionId, adjustedFee, deferFee, queryRunner, session, user, oldFee, newFee, difference, adjustmentTx, err_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        sessionId = dto.sessionId, adjustedFee = dto.adjustedFee, deferFee = dto.deferFee;
                        queryRunner = this.connection.createQueryRunner();
                        return [4, queryRunner.connect()];
                    case 1:
                        _a.sent();
                        return [4, queryRunner.startTransaction()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 10, 12, 14]);
                        return [4, queryRunner.manager.findOne(session_entity_1.Session, { where: { id: sessionId } })];
                    case 4:
                        session = _a.sent();
                        if (!session)
                            throw new common_1.NotFoundException('Session not found');
                        if (session.status !== session_entity_1.SessionStatus.ACTIVE)
                            throw new common_1.BadRequestException('Session is not active');
                        return [4, queryRunner.manager.findOne(user_entity_1.User, { where: { id: session.userId } })];
                    case 5:
                        user = _a.sent();
                        oldFee = Number(session.expectedFee);
                        newFee = deferFee ? 0 : adjustedFee;
                        difference = newFee - oldFee;
                        session.expectedFee = newFee;
                        return [4, queryRunner.manager.save(session)];
                    case 6:
                        _a.sent();
                        adjustmentTx = this.transactionRepository.create({
                            userId: session.userId,
                            expertId: session.expertId,
                            amount: difference,
                            type: transaction_entity_1.TransactionType.ADJUSTMENT,
                            status: transaction_entity_1.TransactionStatus.SUCCESS,
                            referenceId: sessionId,
                            metaData: { deferFee: deferFee, oldFee: oldFee, newFee: newFee },
                        });
                        return [4, queryRunner.manager.save(adjustmentTx)];
                    case 7:
                        _a.sent();
                        user.current_hold = Number(user.current_hold) + difference;
                        return [4, queryRunner.manager.save(user)];
                    case 8:
                        _a.sent();
                        return [4, queryRunner.commitTransaction()];
                    case 9:
                        _a.sent();
                        return [2, session];
                    case 10:
                        err_2 = _a.sent();
                        return [4, queryRunner.rollbackTransaction()];
                    case 11:
                        _a.sent();
                        throw err_2;
                    case 12: return [4, queryRunner.release()];
                    case 13:
                        _a.sent();
                        return [7];
                    case 14: return [2];
                }
            });
        });
    };
    SessionsService.prototype.end = function (dto) {
        return __awaiter(this, void 0, void 0, function () {
            var sessionId, actualFee, queryRunner, session, user, expert, holdAmount, commissionRate, commission, expertEarnings, captureTx, commissionTx, err_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        sessionId = dto.sessionId, actualFee = dto.actualFee;
                        queryRunner = this.connection.createQueryRunner();
                        return [4, queryRunner.connect()];
                    case 1:
                        _a.sent();
                        return [4, queryRunner.startTransaction()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 14, 16, 18]);
                        return [4, queryRunner.manager.findOne(session_entity_1.Session, { where: { id: sessionId } })];
                    case 4:
                        session = _a.sent();
                        if (!session)
                            throw new common_1.NotFoundException('Session not found');
                        if (session.status !== session_entity_1.SessionStatus.ACTIVE)
                            throw new common_1.BadRequestException('Session is not active');
                        return [4, queryRunner.manager.findOne(user_entity_1.User, { where: { id: session.userId } })];
                    case 5:
                        user = _a.sent();
                        return [4, queryRunner.manager.findOne(expert_entity_1.Expert, { where: { id: session.expertId } })];
                    case 6:
                        expert = _a.sent();
                        holdAmount = Number(session.expectedFee);
                        user.current_hold = Number(user.current_hold) - holdAmount;
                        user.max_credits = Number(user.max_credits) - actualFee;
                        return [4, queryRunner.manager.save(user)];
                    case 7:
                        _a.sent();
                        commissionRate = 0.10;
                        commission = actualFee * commissionRate;
                        expertEarnings = actualFee - commission;
                        if (!expert) return [3, 9];
                        expert.currentWalletBalance = Number(expert.currentWalletBalance) + expertEarnings;
                        return [4, queryRunner.manager.save(expert)];
                    case 8:
                        _a.sent();
                        _a.label = 9;
                    case 9:
                        session.actualFee = actualFee;
                        session.endTime = new Date();
                        session.status = session_entity_1.SessionStatus.SETTLED;
                        return [4, queryRunner.manager.save(session)];
                    case 10:
                        _a.sent();
                        captureTx = this.transactionRepository.create({
                            userId: session.userId,
                            expertId: session.expertId,
                            amount: actualFee,
                            type: transaction_entity_1.TransactionType.SESSION_CAPTURE,
                            status: transaction_entity_1.TransactionStatus.SUCCESS,
                            referenceId: sessionId,
                        });
                        return [4, queryRunner.manager.save(captureTx)];
                    case 11:
                        _a.sent();
                        commissionTx = this.transactionRepository.create({
                            userId: session.userId,
                            expertId: session.expertId,
                            amount: commission,
                            type: transaction_entity_1.TransactionType.COMMISSION,
                            status: transaction_entity_1.TransactionStatus.SUCCESS,
                            referenceId: sessionId,
                        });
                        return [4, queryRunner.manager.save(commissionTx)];
                    case 12:
                        _a.sent();
                        return [4, queryRunner.commitTransaction()];
                    case 13:
                        _a.sent();
                        return [2, session];
                    case 14:
                        err_3 = _a.sent();
                        return [4, queryRunner.rollbackTransaction()];
                    case 15:
                        _a.sent();
                        throw err_3;
                    case 16: return [4, queryRunner.release()];
                    case 17:
                        _a.sent();
                        return [7];
                    case 18: return [2];
                }
            });
        });
    };
    SessionsService = __decorate([
        (0, common_1.Injectable)(),
        __param(0, (0, typeorm_1.InjectRepository)(session_entity_1.Session)),
        __param(1, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
        __param(2, (0, typeorm_1.InjectRepository)(expert_entity_1.Expert)),
        __param(3, (0, typeorm_1.InjectRepository)(transaction_entity_1.Transaction)),
        __param(4, (0, typeorm_1.InjectConnection)()),
        __metadata("design:paramtypes", [typeorm_2.Repository,
            typeorm_2.Repository,
            typeorm_2.Repository,
            typeorm_2.Repository, Object])
    ], SessionsService);
    return SessionsService;
}());
exports.SessionsService = SessionsService;
//# sourceMappingURL=sessions.service.js.map