import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('v1/users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Post()
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto);
    }

    @Get(':Webuddy_name')
    findOne(@Param('Webuddy_name') Webuddy_name: string) {
        return this.usersService.findOne(Webuddy_name);
    }

    @Patch(':Webuddy_name')
    update(@Param('Webuddy_name') Webuddy_name: string, @Body() updateUserDto: UpdateUserDto) {
        return this.usersService.update(Webuddy_name, updateUserDto);
    }
}
