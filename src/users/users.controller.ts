import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './user.entity';

/**
 * Fields that must never leave the server.
 *
 * These routes return the User entity directly, which previously shipped the
 * scrypt `passwordHash` (and the Google subject) to every caller - including
 * the Android app, which logs response bodies in debug builds. Strip them at
 * the boundary rather than trusting each call site to remember.
 */
function toSafeUser(user: User) {
    if (!user) return user;
    const { passwordHash, googleId, ...safe } = user as any;
    return safe;
}

@Controller('v1/users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Post()
    async create(@Body() createUserDto: CreateUserDto) {
        return toSafeUser(await this.usersService.create(createUserDto));
    }

    @Get(':Webuddy_name')
    async findOne(@Param('Webuddy_name') Webuddy_name: string) {
        return toSafeUser(await this.usersService.findOne(Webuddy_name));
    }

    @Patch(':Webuddy_name')
    async update(@Param('Webuddy_name') Webuddy_name: string, @Body() updateUserDto: UpdateUserDto) {
        return toSafeUser(await this.usersService.update(Webuddy_name, updateUserDto));
    }

    // NOTE: the Matrix session endpoint deliberately lives on AuthController as
    // POST /v1/auth/matrix-session, authorised by the caller's JWT. It must never
    // be keyed by a path parameter: doing so let anyone holding the single shared
    // INTERNAL_API_TOKEN mint a Matrix access token for ANY user, and that token
    // would have had to ship inside the APK to be usable.
}
