"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
var common_1 = require("@nestjs/common");
var config_1 = require("@nestjs/config");
var typeorm_1 = require("@nestjs/typeorm");
var user_entity_1 = require("./users/user.entity");
var expert_entity_1 = require("./experts/expert.entity");
var bank_detail_entity_1 = require("./experts/bank-detail.entity");
var session_entity_1 = require("./sessions/session.entity");
var transaction_entity_1 = require("./transactions/transaction.entity");
var users_module_1 = require("./users/users.module");
var experts_module_1 = require("./experts/experts.module");
var wallet_module_1 = require("./wallet/wallet.module");
var sessions_module_1 = require("./sessions/sessions.module");
var payouts_module_1 = require("./payouts/payouts.module");
var AppModule = (function () {
    function AppModule() {
    }
    AppModule = __decorate([
        (0, common_1.Module)({
            imports: [
                config_1.ConfigModule.forRoot({
                    isGlobal: true,
                }),
                typeorm_1.TypeOrmModule.forRootAsync({
                    imports: [config_1.ConfigModule],
                    inject: [config_1.ConfigService],
                    useFactory: function (configService) { return ({
                        type: 'mysql',
                        host: configService.get('DB_HOST'),
                        port: configService.get('DB_PORT'),
                        username: configService.get('DB_USER'),
                        password: configService.get('DB_PASSWORD'),
                        database: configService.get('DB_NAME'),
                        entities: [user_entity_1.User, expert_entity_1.Expert, bank_detail_entity_1.BankDetail, session_entity_1.Session, transaction_entity_1.Transaction],
                        synchronize: true,
                    }); },
                }),
                users_module_1.UsersModule,
                experts_module_1.ExpertsModule,
                wallet_module_1.WalletModule,
                sessions_module_1.SessionsModule,
                payouts_module_1.PayoutsModule,
            ],
            controllers: [],
            providers: [],
        })
    ], AppModule);
    return AppModule;
}());
exports.AppModule = AppModule;
//# sourceMappingURL=app.module.js.map