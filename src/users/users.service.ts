import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MatrixService } from '../matrix/matrix.service';

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        @InjectRepository(User)
        private usersRepository: any,
        private readonly matrixService: MatrixService,
    ) { }

    async create(createUserDto: CreateUserDto): Promise<User> {
        // Idempotency guard. After a Clariva sign-up the app still runs its legacy
        // ensureWalletUserExists() path, which POSTs here with the Matrix ID as
        // Webuddy_name. Without this check that would insert a SECOND, orphan row
        // for a user who already exists, splitting their wallet from their account.
        if (createUserDto.Webuddy_name) {
            const existing = await this.usersRepository.findOne({
                where: [
                    { Webuddy_name: createUserDto.Webuddy_name },
                    { matrixUserId: createUserDto.Webuddy_name },
                ],
            });
            if (existing) {
                this.logger.log(`create(): user ${createUserDto.Webuddy_name} already exists, returning it`);
                if (!existing.Webuddy_name) {
                    await this.usersRepository.update(
                        { id: existing.id },
                        { Webuddy_name: createUserDto.Webuddy_name },
                    );
                    existing.Webuddy_name = createUserDto.Webuddy_name;
                }
                return existing;
            }
        }

        const user = this.usersRepository.create(createUserDto);
        const saved: User = await this.usersRepository.save(user);

        // Provision the Matrix account, but never fail signup because of it -
        // it is created on demand later by getMatrixSession() if this fails.
        if (this.matrixService.isEnabled) {
            try {
                // Keyed on the immutable UUID primary key, never on Webuddy_name.
                const session = await this.matrixService.provisionForUser(saved.id, null, saved.name);
                await this.usersRepository.update({ id: saved.id }, { matrixUserId: session.userId });
                saved.matrixUserId = session.userId;
            } catch (error) {
                this.logger.error(`Matrix provisioning failed for user ${saved.id}: ${error.message}`);
            }
        }

        return saved;
    }

    async findOne(Webuddy_name: string): Promise<User> {
        const user = await this.usersRepository.findOne({ where: { Webuddy_name } });
        if (!user) {
            throw new NotFoundException(`User with Webuddy_name ${Webuddy_name} not found`);
        }
        return user;
    }

    async update(Webuddy_name: string, updateUserDto: UpdateUserDto): Promise<User> {
        await this.findOne(Webuddy_name);

        await this.usersRepository.update({ Webuddy_name }, updateUserDto);

        return this.findOne(Webuddy_name);
    }

    // Matrix session issuance lives in AuthService.matrixSessionForUserId, where
    // the caller is identified by a verified JWT rather than a path parameter.
}
