import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private usersRepository: any,
    ) { }

    async create(createUserDto: CreateUserDto): Promise<User> {
        const user = this.usersRepository.create(createUserDto);
        return this.usersRepository.save(user);
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
}
